begin;

-- Historical accessory receipts preserve line prices and recorded average costs.
-- A receipt-level discount has no exact line split in the legacy source.
create function phonebooks_team_private.return_line_values(space uuid, receipt text, receipt_line integer)
returns table(amount_minor bigint,cost_minor bigint) language sql stable set search_path='' as $$
  select case when counts.lines=1 and op.type='purchase' then (
           select coalesce(-sum(p.amount_minor),0)::bigint from phonebooks_team_private.inventory_postings p
           where p.workspace_id=space and p.operation_id=receipt
         ) when counts.lines=1 and op.type='sale' then op.revenue_minor
           when verified.valid then round((legacy.item->>'unitPrice')::numeric*(legacy.item->>'qty')::numeric*100)::bigint end,
         case when verified.valid and jsonb_typeof(legacy.item->'unitCost')='number' then
           round((legacy.item->>'unitCost')::numeric*(legacy.item->>'qty')::numeric*100)::bigint
         when counts.lines=1 and op.type='sale' and (not op.historical or op.cost_minor>0 or receipt like 'warehouse:%') then op.cost_minor end
  from phonebooks_team_private.inventory_operations op
  join phonebooks_team_private.inventory_operation_lines line on line.workspace_id=space and line.operation_id=receipt
    and line.position=receipt_line
  cross join lateral (select count(*) lines from phonebooks_team_private.inventory_operation_lines l
    where l.workspace_id=space and l.operation_id=receipt) counts
  left join lateral (
    select sale->'items'->(receipt_line-1) item, sale->'items' items, coalesce((sale->>'discount')::numeric,0) discount
    from phonebooks_team_private.solo_imports source
    cross join lateral jsonb_array_elements(coalesce(source.historical_details->'accessorySales','[]')) sale
    where source.workspace_id=space and receipt='acc_sale:'||(sale->>'id') limit 1
  ) legacy on true
  cross join lateral (select op.type='sale' and (counts.lines=1 or legacy.discount=0) and
    'accessory:'||(legacy.item->>'itemId')=line.product_id and (legacy.item->>'qty')::integer=line.quantity and
    jsonb_typeof(legacy.item->'unitPrice')='number' and (counts.lines=1 or
      (select sum(round((i->>'unitPrice')::numeric*(i->>'qty')::numeric*100)) from jsonb_array_elements(legacy.items) i)=op.revenue_minor) valid
  ) verified
  where op.workspace_id=space and op.id=receipt;
$$;
revoke all on function phonebooks_team_private.return_line_values(uuid,text,integer) from public,anon,authenticated;

create function phonebooks_team_private.legacy_line_fifo(space uuid, receipt text, receipt_line integer, units integer, recorded_cost bigint)
returns jsonb language sql stable set search_path='' as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object('quantity',(part->>'qty')::integer,
      'costMinor',round((batch->>'unitCost')::numeric*100)*(part->>'qty')::integer,
      'sourceId',case when batch->>'kind'='purchase' then 'acc_batch:'||(batch->>'id') end) order by position)
    from phonebooks_team_private.solo_imports source
    cross join lateral jsonb_array_elements(coalesce(source.historical_details->'accessorySales','[]')) sale
    cross join lateral jsonb_array_elements(coalesce(sale->'items'->(receipt_line-1)->'allocations','[]')) with ordinality entries(part,position)
    cross join lateral jsonb_array_elements(coalesce(source.historical_details->'accessoryBatches','[]')) batch
    where source.workspace_id=space and receipt='acc_sale:'||(sale->>'id')
      and batch->>'id'=part->>'batchId' and jsonb_typeof(batch->'unitCost')='number'
    having sum((part->>'qty')::integer)=units
      and sum(round((batch->>'unitCost')::numeric*100)*(part->>'qty')::integer)=recorded_cost
  ), '[]'::jsonb);
$$;
revoke all on function phonebooks_team_private.legacy_line_fifo(uuid,text,integer,integer,bigint) from public,anon,authenticated;

create or replace function public.phonebooks_team_cloud_command(p_workspace uuid,p_actor uuid,p_request uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  kind text := p_command->>'type';
  sku text := p_command->>'productId';
  actor uuid;
  product phonebooks_team_private.inventory_products;
  booking phonebooks_team_private.stock_reservations;
  saved phonebooks_team_private.cloud_requests;
  original phonebooks_team_private.inventory_operations;
  lot phonebooks_team_private.stock_lots;
  revision bigint;
  units integer := 0;
  original_units integer;
  original_line integer;
  line_count integer;
  line_amount bigint;
  line_cost bigint;
  original_amount bigint;
  used_units integer;
  paid_minor bigint;
  paid_physical bigint;
  amount bigint := 0;
  cash bigint := 0;
  revenue bigint := 0;
  cost bigint := 0;
  expense bigint := 0;
  delta integer := 0;
  available bigint;
  remaining integer;
  skipped integer;
  from_unit integer;
  taken integer;
  part_cost bigint;
  index_no integer := 0;
  fifo_allocations jsonb := '[]';
  allocation jsonb;
  account text := p_command->>'accountId';
  operation_id text := 'cloud:'||p_request;
  booking_id text := p_command->>'reservationId';
  related text := p_command->>'originalId';
  reason text := btrim(p_command->>'reason');
  target_repair boolean := coalesce((p_command->>'toRepair')::boolean,false);
  expiry timestamptz;
  inspected_at timestamptz;
  receipt jsonb;
begin
  if kind is null or kind not in ('sale','repair_start','stock_adjustment','reserve','extend_reserve','cancel_reserve',
    'customer_return','supplier_return','compensation','void_sale') then
    return phonebooks_team_private.stage8_command(p_workspace,p_actor,p_request,p_command);
  end if;
  actor:=phonebooks_team_private.inventory_actor(p_workspace);
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  if p_request is null or jsonb_typeof(p_command) is distinct from 'object' then raise sqlstate 'PT400' using message='Invalid command'; end if;
  if kind='sale' and p_command-array['type','productId','expectedVersion','quantity','unitPriceMinor','accountId','reservationId'] <> '{}' then
    raise sqlstate 'PT400' using message='Invalid sale command';
  end if;
  select cloud_revision+1 into revision from phonebooks_team_private.workspaces where id=p_workspace for update;
  perform phonebooks_team_private.inventory_actor(p_workspace);
  perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.read'] || case kind
    when 'sale' then array['trade.sale']
    when 'repair_start' then array['repair.start']
    when 'stock_adjustment' then array['stock.adjust']
    when 'reserve' then array['trade.reserve']
    when 'extend_reserve' then array['trade.reserve']
    when 'cancel_reserve' then array['trade.reserve_cancel']
    when 'supplier_return' then array['trade.supplier_return']
    when 'compensation' then array['trade.compensation']
    else array['trade.customer_return'] end);
  if kind='stock_adjustment' and (p_command->>'quantity')::integer<0 then
    perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.writeoff']);
  end if;
  if target_repair then perform phonebooks_team_private.require_permissions(p_workspace,actor,array['repair.start']); end if;

  select * into saved from phonebooks_team_private.cloud_requests where workspace_id=p_workspace and request_id=p_request;
  if found then
    if saved.actor_id=actor and saved.command=p_command then return saved.result; end if;
    raise sqlstate 'PT409' using message='Request ID already used';
  end if;
  select * into product from phonebooks_team_private.inventory_products where workspace_id=p_workspace and id=sku and archived_at is null for update;
  if not found or product.version is distinct from phonebooks_team_private.cloud_integer(p_command->'expectedVersion',1,2147483647) then
    raise sqlstate 'PT409' using message='Product changed';
  end if;
  inspected_at:=clock_timestamp();
  available:=product.quantity-product.reserved_quantity-phonebooks_team_private.held_units(p_workspace,sku,inspected_at);
  if booking_id is not null then
    select * into booking from phonebooks_team_private.stock_reservations where workspace_id=p_workspace and id=booking_id and product_id=sku
      and status='active' and quantity>0 and expires_at>inspected_at for update;
    if not found then raise sqlstate 'PT409' using message='Reservation unavailable'; end if;
  end if;

  if kind='sale' then
    units:=phonebooks_team_private.cloud_integer(p_command->'quantity',1,100000);
    if booking_id is not null and (units>booking.quantity or
      phonebooks_team_private.cloud_integer(p_command->'unitPriceMinor',1,10000000000)<>booking.unit_minor) then
      raise sqlstate 'PT409' using message='Reservation quantity or price changed';
    end if;
    if units>available+coalesce(booking.quantity,0) then raise sqlstate 'PT409' using message='Insufficient available stock'; end if;
    fifo_allocations:=phonebooks_team_private.fifo_receipt(p_workspace,sku,units);
    receipt:=phonebooks_team_private.stage8_command(p_workspace,p_actor,p_request,p_command-'reservationId');
    update phonebooks_team_private.inventory_operation_lines set allocations=fifo_allocations
      where workspace_id=p_workspace and inventory_operation_lines.operation_id='cloud:'||p_request and product_id=sku;
    if booking_id is not null then
      update phonebooks_team_private.stock_reservations set quantity=booking.quantity-units,
        status=case when booking.quantity=units then 'sold' else 'active' end
        where workspace_id=p_workspace and id=booking_id;
      update phonebooks_team_private.cloud_requests set command=p_command where workspace_id=p_workspace and request_id=p_request;
      update phonebooks_team_private.inventory_operations set request_payload=request_payload||jsonb_build_object('reservationId',booking_id)
        where workspace_id=p_workspace and id='cloud:'||p_request;
      update phonebooks_team_private.team_audit log set current_values=log.current_values||jsonb_build_object('reservationId',booking_id)
        where log.workspace_id=p_workspace and log.target_id='cloud:'||p_request and log.kind='sale';
    end if;
    return receipt;
  elsif kind in ('repair_start','stock_adjustment') then
    if (kind='repair_start' and available<1) or
      (kind='stock_adjustment' and (p_command->>'quantity')::integer < -available) then
      raise sqlstate 'PT409' using message='Stock reserved';
    end if;
    return phonebooks_team_private.stage8_command(p_workspace,p_actor,p_request,p_command);
  elsif kind='reserve' then
    if p_command-array['type','productId','expectedVersion','quantity','unitPriceMinor','buyer','contact','note','expiresAt'] <> '{}' then
      raise sqlstate 'PT400' using message='Invalid reservation';
    end if;
    units:=phonebooks_team_private.cloud_integer(p_command->'quantity',1,100000);
    if product.in_repair or units>available then raise sqlstate 'PT409' using message='Insufficient available stock'; end if;
    expiry:=(p_command->>'expiresAt')::timestamptz;
    if expiry is null or not isfinite(expiry) or expiry<=inspected_at then raise sqlstate 'PT400' using message='Expiry must be in the future'; end if;
    insert into phonebooks_team_private.stock_reservations(workspace_id,id,product_id,actor_id,quantity,unit_minor,buyer,contact,note,expires_at)
      values(p_workspace,operation_id,sku,actor,units,phonebooks_team_private.cloud_integer(p_command->'unitPriceMinor',1,10000000000),
        btrim(p_command->>'buyer'),coalesce(p_command->>'contact',''),coalesce(p_command->>'note',''),expiry);
  elsif kind in ('extend_reserve','cancel_reserve') then
    if booking_id is null or p_command-array['type','productId','expectedVersion','reservationId','expiresAt'] <> '{}' then
      raise sqlstate 'PT400' using message='Invalid reservation';
    end if;
    if kind='extend_reserve' then
      expiry:=(p_command->>'expiresAt')::timestamptz;
      if expiry is null or not isfinite(expiry) or expiry<=booking.expires_at then raise sqlstate 'PT400' using message='Expiry must increase'; end if;
      update phonebooks_team_private.stock_reservations set expires_at=expiry where workspace_id=p_workspace and id=booking_id;
    else
      update phonebooks_team_private.stock_reservations set status='cancelled' where workspace_id=p_workspace and id=booking_id;
    end if;
  else
    if p_command-array['type','productId','expectedVersion','originalId','originalLine','quantity','amountMinor','reason','accountId','toRepair'] <> '{}'
      or coalesce(length(reason),0) not between 1 and 500
      or (target_repair and (kind not in ('customer_return','void_sale') or product.tracking<>'unit')) then
      raise sqlstate 'PT400' using message='Invalid return';
    end if;
    units:=phonebooks_team_private.cloud_integer(p_command->'quantity',case when kind='compensation' then 0 else 1 end,
      case when kind='compensation' then 0 else 100000 end);
    select * into original from phonebooks_team_private.inventory_operations where workspace_id=p_workspace and id=related and status='posted'
      and type=case when kind='supplier_return' then 'purchase' else 'sale' end;
    if not found then raise sqlstate 'PT409' using message='Original operation unavailable'; end if;
    select count(*) into line_count from phonebooks_team_private.inventory_operation_lines entry
      where entry.workspace_id=p_workspace and entry.operation_id=related;
    if p_command ? 'originalLine' then
      original_line:=phonebooks_team_private.cloud_integer(p_command->'originalLine',1,2147483647);
    elsif line_count=1 then original_line:=1;
    else raise sqlstate 'PT409' using message='Choose the original receipt line'; end if;
    select line.quantity,line.allocations into original_units,fifo_allocations
      from phonebooks_team_private.inventory_operation_lines line
      where line.workspace_id=p_workspace and line.operation_id=related and line.product_id=sku and line.position=original_line;
    if not found then raise sqlstate 'PT409' using message='Original product mismatch'; end if;
    select amount_minor,cost_minor into line_amount,line_cost
      from phonebooks_team_private.return_line_values(p_workspace,related,original_line);
    original_amount:=line_amount;
    if original_amount is null or (kind='void_sale' and line_count<>1) then
      raise sqlstate 'PT409' using message='Original receipt line amount unavailable';
    end if;
    amount:=case when kind='void_sale' and p_command->>'amountMinor' is null then original_amount
      else phonebooks_team_private.cloud_integer(p_command->'amountMinor',case when kind='compensation' then 1 else 0 end,9007199254740991) end;
    select coalesce(sum(abs(line.stock_delta)),0),
      coalesce(sum((op.request_payload->>'returnMinor')::bigint),0),
      coalesce(sum((op.request_payload->>'returnMinor')::bigint) filter(where line.stock_delta<>0),0)
      into used_units,paid_minor,paid_physical
      from phonebooks_team_private.inventory_operations op
      join phonebooks_team_private.inventory_operation_lines line on line.workspace_id=p_workspace and line.operation_id=op.id
      where op.workspace_id=p_workspace and op.related_id=related and op.type in ('customer_return','supplier_return') and op.status='posted'
        and coalesce((op.request_payload->>'originalLine')::integer,1)=original_line;
    if units+used_units>original_units or amount+paid_minor>original_amount or
      (units>0 and amount+paid_physical>trunc(original_amount::numeric*(units+used_units)/original_units)) or
      (kind='void_sale' and (units<>original_units or amount<>original_amount or used_units<>0 or paid_minor<>0)) then
      raise sqlstate 'PT409' using message='Return exceeds original operation';
    end if;
    if amount>0 then
      if not exists(select from phonebooks_team_private.inventory_accounts a where a.workspace_id=p_workspace and a.id=account and a.archived_at is null) then
        raise sqlstate 'PT400' using message='Active cash account required';
      end if;
      if kind<>'supplier_return' and amount>(select a.opening_balance_minor+coalesce(m.delta_minor,0)
        from phonebooks_team_private.inventory_accounts a left join phonebooks_team_private.inventory_account_movements m
        on m.workspace_id=a.workspace_id and m.account_id=a.id where a.workspace_id=p_workspace and a.id=account) then
        raise sqlstate 'PT409' using message='Insufficient funds';
      end if;
    end if;
    if kind='supplier_return' then
      if units>available or product.in_repair then raise sqlstate 'PT409' using message='Stock unavailable'; end if;
      remaining:=units;
      for lot in select * from phonebooks_team_private.stock_lots
        where workspace_id=p_workspace and product_id=sku and quantity>0
          and (origin_purchase=related or (origin_purchase is null and (id=related or 'acc_batch:'||id=related)))
        order by acquired_revision,id for update loop
        taken:=least(remaining,lot.quantity);
        part_cost:=trunc(lot.cost_minor::numeric*taken/lot.quantity);
        update phonebooks_team_private.stock_lots set quantity=lot.quantity-taken,cost_minor=lot.cost_minor-part_cost
          where workspace_id=p_workspace and product_id=sku and id=lot.id;
        expense:=expense+part_cost;
        remaining:=remaining-taken;
        exit when remaining=0;
      end loop;
      if remaining<>0 then raise sqlstate 'PT409' using message='Original lot unavailable'; end if;
      delta:=-units; cash:=amount; expense:=expense-amount;
    else
      if units>0 then
        if product.tracking='unit' and product.quantity<>0 then raise sqlstate 'PT409' using message='Product already in stock'; end if;
        if coalesce((select sum((entry->>'quantity')::integer) from jsonb_array_elements(fifo_allocations) entry
          where entry ? 'costMinor'),0)<>original_units then
          fifo_allocations:=phonebooks_team_private.legacy_line_fifo(p_workspace,related,original_line,original_units,line_cost);
        end if;
        if jsonb_array_length(fifo_allocations)=0 then
          if line_cost is null then raise sqlstate 'PT409' using message='Original cost unavailable'; end if;
          if original.historical and units<>original_units and related like 'acc_sale:%' then
            raise sqlstate 'PT409' using message='Original FIFO detail unavailable';
          end if;
          fifo_allocations:=jsonb_build_array(jsonb_build_object('quantity',original_units,'costMinor',line_cost));
        end if;
        remaining:=units; skipped:=used_units;
        for allocation in select value from jsonb_array_elements(fifo_allocations) loop
          taken:=(allocation->>'quantity')::integer;
          from_unit:=least(skipped,taken); skipped:=skipped-from_unit;
          taken:=least(remaining,taken-from_unit);
          if taken=0 then continue; end if;
          part_cost:=trunc((allocation->>'costMinor')::numeric*(from_unit+taken)/(allocation->>'quantity')::integer)
            -trunc((allocation->>'costMinor')::numeric*from_unit/(allocation->>'quantity')::integer);
          index_no:=index_no+1;
          insert into phonebooks_team_private.stock_lots(workspace_id,product_id,id,acquired_revision,quantity,cost_minor,origin_purchase)
            values(p_workspace,sku,operation_id||':'||index_no,revision,taken,part_cost,allocation->>'sourceId');
          cost:=cost-part_cost; remaining:=remaining-taken;
          exit when remaining=0;
        end loop;
        if remaining<>0 then raise sqlstate 'PT409' using message='Original allocation unavailable'; end if;
      end if;
      delta:=units; cash:=-amount; revenue:=-amount;
    end if;
  end if;

  update phonebooks_team_private.inventory_products set quantity=quantity+delta,version=version+1,
    cloud_revision=revision,in_repair=in_repair or target_repair
    where workspace_id=p_workspace and id=sku;
  perform phonebooks_team_private.record_inventory_operation(p_workspace,p_request,jsonb_build_object(
    'id',operation_id,'version',1,'type',case when kind in ('reserve','extend_reserve','cancel_reserve') then 'reservation'
      when kind in ('compensation','void_sale') then 'customer_return' else kind end,'status','posted','date',current_date,
    'relatedId',related,'originalLine',original_line,'tradeMode',kind,'returnMinor',amount,'reason',reason,'reservationId',booking_id,
    'revenueMinor',revenue,'costMinor',cost,'expenseMinor',expense,
    'lines',jsonb_build_array(jsonb_build_object('productId',sku,'quantity',greatest(1,units),'stockDelta',delta)),
    'postings',case when cash=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('accountId',account,'amountMinor',cash)) end));
  update phonebooks_team_private.inventory_operations set cloud_revision=revision where workspace_id=p_workspace and id='cloud:'||p_request;
  update phonebooks_team_private.team_audit log
    set current_values=log.current_values||jsonb_strip_nulls(jsonb_build_object(
      'tradeMode',p_command->>'type','originalId',related,'originalLine',original_line,'reservationId',coalesce(booking_id,case when p_command->>'type'='reserve' then operation_id end))),
      financial=log.kind<>'reservation',
      stock=log.kind='reservation',
      amount_minor=case when log.kind<>'reservation' then amount end
    where log.workspace_id=p_workspace and log.target_id='cloud:'||p_request
      and log.kind in ('customer_return','supplier_return','reservation');
  if cash<>0 then update phonebooks_team_private.inventory_accounts set cloud_revision=revision,version=version+1
    where workspace_id=p_workspace and id=account; end if;
  update phonebooks_team_private.workspaces set cloud_revision=revision where id=p_workspace;
  receipt:=jsonb_build_object('operationId',operation_id,'revision',revision::text);
  insert into phonebooks_team_private.cloud_requests values(p_workspace,p_request,actor,p_command,receipt);
  return receipt;
exception when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
  raise sqlstate 'PT400' using message='Invalid trade document';
end;
$$;
create or replace function public.phonebooks_team_trade_context(p_workspace uuid,p_actor uuid,p_product text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid:=phonebooks_team_private.inventory_actor(p_workspace);
  rights text[]:=phonebooks_team_private.team_permissions(p_workspace,actor);
  result jsonb;
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.read']);
  if p_product is null then return jsonb_build_object('now',statement_timestamp(),'holds',(
    select coalesce(jsonb_agg(jsonb_build_object('productId',product_id,'quantity',quantity,'expiresAt',expires_at)),'[]')
    from phonebooks_team_private.stock_reservations where workspace_id=p_workspace and status='active' and expires_at>statement_timestamp()
  )); end if;
  select jsonb_build_object('now',statement_timestamp(),'reservations',
    case when rights && array['trade.sale','trade.reserve','trade.reserve_cancel'] then (
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'quantity',quantity,'unitMinor',unit_minor::text,'buyer',buyer,
        'contact',case when rights && array['trade.reserve','trade.reserve_cancel'] then contact end,
        'note',case when rights && array['trade.reserve','trade.reserve_cancel'] then note end,'expiresAt',expires_at) order by expires_at,id),'[]')
      from phonebooks_team_private.stock_reservations
      where workspace_id=p_workspace and product_id=p_product and status='active' and expires_at>statement_timestamp()
    ) else '[]'::jsonb end,
    'accounts',case when rights && array['trade.customer_return','trade.supplier_return','trade.compensation'] then (
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]')
      from phonebooks_team_private.inventory_accounts where workspace_id=p_workspace and archived_at is null
    ) else '[]'::jsonb end,
    'originals',coalesce((
      select jsonb_agg(item order by occurred_on desc,recorded_at desc) from (
        select op.occurred_on,op.recorded_at,jsonb_build_object('id',op.id,'line',line.position,'type',op.type,'date',op.occurred_on,
          'units',line.quantity,'leftUnits',line.quantity-coalesce(previous.units,0),
          'amountMinor',case when gross.visible then gross.amount::text end,
          'leftMinor',case when gross.visible then (gross.amount-coalesce(previous.paid,0))::text end,
          'hasMoney',gross.amount>coalesce(previous.paid,0),
          'canReturn',op.type<>'sale' or item_value.cost_minor is not null or coalesce((
            select sum((part->>'quantity')::integer) from jsonb_array_elements(line.allocations) part where part ? 'costMinor'
          ),0)=line.quantity,
          'canVoid',op.type='sale' and item_value.cost_minor is not null and (select count(*) from phonebooks_team_private.inventory_operation_lines x where x.workspace_id=p_workspace and x.operation_id=op.id)=1 and coalesce(previous.units,0)=0 and coalesce(previous.paid,0)=0) item
        from phonebooks_team_private.inventory_operation_lines line
        join phonebooks_team_private.inventory_operations op on op.workspace_id=line.workspace_id and op.id=line.operation_id and op.status='posted'
        cross join lateral phonebooks_team_private.return_line_values(p_workspace,op.id,line.position) item_value
        cross join lateral (select item_value.amount_minor as amount,
          case when op.type='sale' then 'finance.revenue.read'=any(rights) else 'stock.purchase_price.read'=any(rights) end as visible) gross
        left join lateral (select sum(abs(corrected.stock_delta)) units,sum((correction.request_payload->>'returnMinor')::bigint) paid
          from phonebooks_team_private.inventory_operations correction
          join phonebooks_team_private.inventory_operation_lines corrected on corrected.workspace_id=p_workspace and corrected.operation_id=correction.id
          where correction.workspace_id=p_workspace and correction.related_id=op.id and correction.type in ('customer_return','supplier_return')
            and correction.status='posted' and coalesce((correction.request_payload->>'originalLine')::integer,1)=line.position) previous on true
        where line.workspace_id=p_workspace and line.product_id=p_product
          and ((op.type='sale' and rights && array['trade.customer_return','trade.compensation'])
            or (op.type='purchase' and 'trade.supplier_return'=any(rights)))
          and gross.amount is not null
          and (line.quantity>coalesce(previous.units,0) or gross.amount>coalesce(previous.paid,0))
        order by op.occurred_on desc,op.recorded_at desc,op.id desc
      ) originals
    ),'[]')) into result;
  return result;
end;
$$;
commit;

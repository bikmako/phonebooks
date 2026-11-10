/**
 * Настройки, бэкапы, проверка данных.
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { AuditLogModal } from "../components/settings/AuditLogModal.jsx";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  ConfirmDialog,
  Input,
  Modal,
  cx,
} from "../components/ui.jsx";
import { checkDataIntegrity } from "../domain/integrity.js";
import { useStore } from "../hooks/useStore.jsx";
import { ThemePicker } from "../hooks/useTheme.jsx";
import {
  buildExportFile,
  downloadJson,
  getStorageEstimate,
  parseImportFile,
} from "../storage/db.js";
import { formatDateTime, plural, today } from "../utils/format.js";
import {
  CircleCheck,
  Download,
  HardDrive,
  History,
  RotateCcw,
  Shield,
  Smartphone,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
export function formatBytes(s) {
  return s < 1024
    ? `${s} Б`
    : s < 1024 * 1024
      ? `${(s / 1024).toFixed(0)} КБ`
      : `${(s / (1024 * 1024)).toFixed(1)} МБ`;
}
export function formatSavedAt(s) {
  if (!s) return "ещё не сохранялось";
  const t = Date.now() - new Date(s).getTime();
  return t < 6e4
    ? "только что"
    : t < 36e5
      ? `${Math.floor(t / 6e4)} мин назад`
      : t < 864e5
        ? `${Math.floor(t / 36e5)} ч назад`
        : formatDateTime(s);
}
export function SettingsPage() {
  var G, ee;
  const {
      data: s,
      replaceAll: t,
      resetData: n,
      notify: a,
      saveState: c,
      savedAt: r,
      saveError: i,
      backups: o,
      makeBackup: l,
      restoreBackup: d,
      storage: x,
      issues: v,
    } = useStore(),
    [p, w] = React.useState(s.settings.businessName),
    [A, L] = React.useState(!1),
    [O, m] = React.useState(null),
    [f, C] = React.useState(null),
    [S, g] = React.useState(!1),
    [b, B] = React.useState(!1),
    [y, j] = React.useState(x);
  (React.useEffect(() => w(s.settings.businessName), [s.settings.businessName]),
    React.useEffect(() => {
      getStorageEstimate().then(j);
    }, [s]));
  const u = React.useMemo(() => (v.length ? v : checkDataIntegrity(s)), [v, s]),
    N = () => {
      const W = p.trim();
      W.length < 2 ||
        (t({
          ...s,
          settings: {
            ...s.settings,
            businessName: W,
          },
        }),
        a({
          title: "Название сохранено",
          tone: "success",
        }));
    },
    E = () => {
      (downloadJson(`phonebooks-${today()}.json`, buildExportFile(s)),
        a({
          title: "Файл сохранён",
          description: "Копия базы данных скачана на устройство",
          tone: "success",
        }));
    },
    R = (W) => {
      const ie = new FileReader();
      ((ie.onload = () => {
        const { data: Q, error: V } = parseImportFile(String(ie.result));
        if (!Q) {
          a({
            title: "Не удалось прочитать файл",
            description: V ?? "Ошибка",
            tone: "error",
          });
          return;
        }
        m(Q);
      }),
        ie.readAsText(W));
    },
    M = {
      phones: s.phones.length,
      sales: s.sales.length,
      operations: s.expenses.length + s.transfers.length + s.cashOps.length,
    };
  return (
    <div className="space-y-4">
      <Card className="card-pad">
        <CardHeader
          title="Бизнес"
          subtitle="Название отображается в шапке приложения"
        />
        <div className="mt-3 flex gap-2">
          <Input
            value={p}
            onChange={(W) => w(W.target.value)}
            placeholder="Название бизнеса"
            aria-label="Название бизнеса"
          />
          <Button
            onClick={N}
            disabled={p.trim().length < 2 || p === s.settings.businessName}
          >
            Сохранить
          </Button>
        </div>
      </Card>
      <Card className="card-pad">
        <CardHeader
          title="Оформление"
          subtitle="Тема сохраняется на этом устройстве"
        />
        <div className="mt-3">
          <ThemePicker />
        </div>
      </Card>
      <Card className="card-pad">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cx(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                c === "error"
                  ? "bg-red-50 text-red-500"
                  : "bg-emerald-50 text-emerald-600",
              )}
            >
              <HardDrive className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink-900">
                Данные на устройстве
              </p>
              <p className="truncate text-[11.5px] text-ink-500">
                {c === "saving"
                  ? "Сохраняю…"
                  : c === "error"
                    ? (i ?? "Ошибка записи")
                    : `Сохранено ${formatSavedAt(r)}`}
              </p>
            </div>
          </div>
          <Chip
            tone={c === "error" ? "danger" : "success"}
            className="shrink-0"
          >
            {c === "error" ? "Ошибка" : "IndexedDB"}
          </Chip>
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-500">
          {M.phones} {plural(M.phones, "телефон", "телефона", "телефонов")}
          {" · "}
          {M.sales} {plural(M.sales, "продажа", "продажи", "продаж")}
          {" · "}
          {M.operations}{" "}
          {plural(M.operations, "операция", "операции", "операций")}
          {y ? ` · ${formatBytes(y.used)} занято` : ""}
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
          База хранится локально в браузере, в облако ничего не отправляется.
          Данные остаются после закрытия Safari и перезагрузки телефона.
        </p>
      </Card>
      <Card className="card-pad">
        <CardHeader
          title="Резервные копии"
          subtitle={
            o.length
              ? `${o.length} ${plural(o.length, "копия", "копии", "копий")} внутри приложения`
              : "Пока нет копий"
          }
        />
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            variant="secondary"
            icon={<Download className="h-4 w-4" />}
            onClick={E}
            className="justify-start"
          >
            Скачать файл
          </Button>
          <label className="btn-secondary btn-md cursor-pointer justify-start">
            <Upload className="h-4 w-4" />
            {" Загрузить из файла"}
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(W) => {
                var Q;
                const ie = (Q = W.target.files) == null ? void 0 : Q[0];
                (ie && R(ie), (W.target.value = ""));
              }}
            />
          </label>
          <Button
            variant="secondary"
            icon={<RotateCcw className="h-4 w-4" />}
            onClick={() => B(!0)}
            className="justify-start"
          >
            Точки восстановления ({o.length})
          </Button>
          <Button
            variant="secondary"
            icon={<Shield className="h-4 w-4" />}
            onClick={() => void l("manual")}
            className="justify-start"
          >
            Сделать копию сейчас
          </Button>
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-500">
          Файл с расширением .json можно сохранить в «Файлы» на iPhone или
          отправить себе — из него база восстанавливается на любом устройстве.
        </p>
      </Card>
      <Card className="card-pad">
        <CardHeader
          title="Проверка данных"
          subtitle="Двойные продажи, отрицательные остатки, расхождения"
        />
        <div
          className={cx(
            "mt-3 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[12.5px]",
            u.length === 0
              ? "bg-emerald-50 text-emerald-800"
              : "bg-amber-50 text-amber-800",
          )}
        >
          {u.length === 0 ? (
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div>
            <p className="font-semibold">
              {u.length === 0
                ? "Всё сходится"
                : `Найдено ${u.length} замечаний`}
            </p>
            {u.length === 0 ? (
              <p className="mt-0.5 text-emerald-700">
                Двойных продаж и минусов нет. Все показатели рассчитаны из
                операций.
              </p>
            ) : (
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-700">
                {u.slice(0, 5).map((W, ie) => (
                  <li key={ie}>{W.message}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            variant="secondary"
            icon={<History className="h-4 w-4" />}
            onClick={() => g(!0)}
            className="justify-start"
          >
            Журнал изменений ({s.audit.length})
          </Button>
        </div>
      </Card>
      <details className="group rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-semibold text-ink-900">
          <span className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-ink-400" />
            {" Установить на iPhone"}
          </span>
          <span className="text-[11.5px] font-normal text-brand-600 group-open:hidden">
            Как?
          </span>
        </summary>
        <ol className="mt-2.5 space-y-1.5 text-[12px] text-ink-500">
          <li>1. Откройте сайт в Safari</li>
          <li>2. Нажмите «Поделиться» (квадрат со стрелкой)</li>
          <li>3. Выберите «На экран "Домой"»</li>
          <li>
            4. Открывайте с иконки — приложение запустится без адресной строки,
            офлайн тоже работает
          </li>
        </ol>
      </details>
      <Card className="card-pad">
        <p className="text-[12px] leading-relaxed text-ink-500">
          Все изменения записываются в журнал и сохраняются сразу. Удаление и
          отмены пересчитывают склад, кассу и прибыль.
        </p>
        <button
          onClick={() => L(!0)}
          className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-red-500 active:opacity-70"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {" Очистить все данные и начать с нуля"}
        </button>
      </Card>
      <p className="px-1 pb-2 text-center text-[11px] text-ink-400">
        PhoneBooks · бухгалтерия скупки смартфонов · данные принадлежат вам
      </p>
      <AuditLogModal open={S} onClose={() => g(!1)} />
      <Modal
        open={b}
        onClose={() => B(!1)}
        title="Точки восстановления"
        description="Автоматические копии последних изменений — хранятся 10 штук на устройстве"
      >
        <div className="space-y-2">
          {o.length === 0 && (
            <p className="py-6 text-center text-[13px] text-ink-400">
              Копий пока нет
            </p>
          )}
          {o.map((W) => (
            <div
              className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5"
              key={W.id}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-ink-900">
                  {formatDateTime(W.at)}
                </p>
                <p className="text-[11px] text-ink-400">
                  {W.phones}{" "}
                  {plural(W.phones, "телефон", "телефона", "телефонов")}
                  {" · "}
                  {W.sales} {plural(W.sales, "продажа", "продажи", "продаж")}
                  {" ·"}{" "}
                  {W.reason === "manual"
                    ? "вручную"
                    : W.reason === "import"
                      ? "перед импортом"
                      : "авто"}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => C(W.id)}>
                Восстановить
              </Button>
            </div>
          ))}
        </div>
      </Modal>
      <ConfirmDialog
        open={A}
        onClose={() => L(!1)}
        onConfirm={n}
        title="Очистить все данные?"
        description="Будут удалены все телефоны, продажи, расходы и операции. Останется одна пустая касса. Перед очисткой создаётся резервная копия — восстановить можно здесь же."
        confirmLabel="Очистить всё"
      />
      <ConfirmDialog
        open={!!O}
        onClose={() => m(null)}
        onConfirm={() => {
          (O &&
            (t(O),
            a({
              title: "Данные восстановлены",
              description: "Файл загружен",
              tone: "success",
            })),
            m(null));
        }}
        title="Восстановить из файла?"
        description={
          O
            ? `В файле ${((G = O.phones) == null ? void 0 : G.length) ?? 0} телефонов и ${((ee = O.sales) == null ? void 0 : ee.length) ?? 0} продаж. Текущие данные будут заменены, старая база сохранится в точках восстановления.`
            : void 0
        }
        confirmLabel="Восстановить"
        tone="primary"
      />
      <ConfirmDialog
        open={!!f}
        onClose={() => C(null)}
        onConfirm={async () => {
          (f && (await d(f)), C(null), B(!1));
        }}
        title="Вернуть данные из копии?"
        description="Текущее состояние тоже сохранится в точках восстановления — вернуться назад можно будет всегда."
        confirmLabel="Восстановить"
        tone="primary"
      />
    </div>
  );
}

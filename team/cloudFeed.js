const sections = ['categories', 'products', 'accounts', 'operations'];
const sameAccess = (a, b) => a.role === b.role && String(a.permissions) === String(b.permissions);

export async function readCloudFeed(api, scope, current, onAccessChanged) {
  async function scan(previous) {
    let position = { since: previous?.cursor ?? null };
    let access = previous;
    let contents;
    let totals = previous?.totals ?? null;
    do {
      const page = await api('cloud/feed', { ...scope, p_position: position });
      if (access && !sameAccess(access, page)) return null;
      access = page;
      if (previous && !page.next && previous.cursor === page.cursor && !contents &&
        sections.every(section => page[section].length === 0) && !Object.hasOwn(page, 'totals')) return previous;
      contents ??= Object.fromEntries(sections.map(section => [
        section, new Map((previous?.[section] ?? []).map(row => [row.id, row])),
      ]));
      for (const section of sections) for (const row of page[section]) contents[section].set(row.id, row);
      if (Object.hasOwn(page, 'totals')) totals = page.totals;
      position = page.next;
    } while (position);
    return {
      ...Object.fromEntries(sections.map(section => [section, [...contents[section].values()]])),
      operations: [...contents.operations.values()].slice(-50),
      cursor: access.cursor, role: access.role, permissions: access.permissions, totals,
    };
  }
  try {
    const result = await scan(current);
    if (result) return result;
  } catch (error) {
    if (error.status !== 409) throw error;
  }
  onAccessChanged();
  const reset = await scan(null);
  if (!reset) throw new Error('Права изменились во время загрузки.');
  return reset;
}

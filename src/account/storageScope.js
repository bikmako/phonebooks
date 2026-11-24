let accountId;

// A document can bind to one verified identity for its entire lifetime. Account
// switches load a new document, so queued saves cannot follow a new identity.
export function bindAccountStorage(id) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || (accountId && accountId !== id)) {
    throw new Error("Не удалось открыть хранилище аккаунта");
  }
  accountId = id;
}

export function accountDatabaseName(legacyName) {
  return accountId ? legacyName + ":account:" + accountId : legacyName;
}

export function hasAccountStorage() {
  return Boolean(accountId);
}

export function localKey(key) {
  return accountId ? "pb.account." + accountId + "." + key : key;
}

export function localKeys(storage) {
  const keys = Object.keys(storage);
  if (!accountId) return keys;
  const prefix = localKey("");
  return keys.filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length));
}

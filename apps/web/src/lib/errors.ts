export type AppError = {
  /** Stable identity — overwriting an existing error with the same key updates it. */
  key: string;
  title: string;
  message: string;
};

export function upsertError(list: AppError[], err: AppError): AppError[] {
  const idx = list.findIndex((e) => e.key === err.key);
  if (idx === -1) return [...list, err];
  const existing = list[idx]!;
  if (existing.title === err.title && existing.message === err.message) {
    return list;
  }
  const next = list.slice();
  next[idx] = err;
  return next;
}

export function removeErrorByKey(list: AppError[], key: string): AppError[] {
  const idx = list.findIndex((e) => e.key === key);
  if (idx === -1) return list;
  return list.filter((e) => e.key !== key);
}

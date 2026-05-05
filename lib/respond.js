// Standard response helpers — keep all endpoint output consistent

export const ok = (res, data, extra = {}) =>
  res.json({ status: true, code: 200, ...extra, result: data });

export const fail = (res, code, message, extra = {}) =>
  res.status(code).json({ status: false, code, message, ...extra });

export const tryCatch = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (e) {
    console.error(`[${req.originalUrl}]`, e?.message || e);
    fail(res, 500, e?.message || "Internal server error");
  }
};

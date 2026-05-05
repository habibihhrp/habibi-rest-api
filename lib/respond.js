// Standard response helpers — keep all endpoint output consistent

export const ok = (res, data, extra = {}) =>
  res.json({ status: true, code: 200, ...extra, result: data });

export const fail = (res, code, message, extra = {}) =>
  res.status(code).json({ status: false, code, message, ...extra });

// Differentiate upstream/network errors (return 502 Bad Gateway with descriptive
// message) from genuine server bugs (return 500). Axios errors carry .response
// (HTTP error from upstream) or .code (network error e.g. ECONNREFUSED, ETIMEDOUT).
export const tryCatch = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (e) {
    const isAxios = !!(e?.isAxiosError || e?.response || e?.code);
    if (isAxios) {
      const upstreamCode = e?.response?.status;
      const upstreamMsg =
        e?.response?.data?.text ||
        e?.response?.data?.message ||
        e?.message ||
        "Upstream service error";
      console.error(`[${req.originalUrl}] upstream:`, upstreamCode || e?.code, upstreamMsg);
      return fail(res, 502, `Upstream service unavailable: ${upstreamMsg}`, {
        upstream_status: upstreamCode || e?.code || null,
      });
    }
    console.error(`[${req.originalUrl}]`, e?.message || e);
    return fail(res, 500, e?.message || "Internal server error");
  }
};

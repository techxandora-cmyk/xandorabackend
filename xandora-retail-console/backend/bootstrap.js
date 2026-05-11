const realMode =
  String(process.env.RETAIL_REAL_MODE || "").trim() === "1" ||
  Boolean(String(process.env.RETAIL_BACKEND_URL || "").trim());

if (realMode) {
  require("./server.real");
} else {
  require("./server");
}

const net = require("net");

const server = net.createServer((socket) => {
  console.log("🔥 Reader connected:", socket.remoteAddress);

  socket.on("data", (data) => {
    console.log("📦 Data received:", data.toString("hex"));
  });

  socket.on("end", () => {
    console.log("❌ Reader disconnected");
  });

  socket.on("error", (err) => {
    console.error("Socket error:", err.message);
  });
});

server.listen(5084, "0.0.0.0", () => {
  console.log("🚀 LLRP Test Server listening on port 5084");
});

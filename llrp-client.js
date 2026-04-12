const net = require("net");

const socket = new net.Socket();

socket.connect(5084, "192.168.100.50", () => {
  console.log("TCP Connected to reader");
});

socket.on("data", (data) => {
  console.log("Received:", data);
});

socket.on("close", () => {
  console.log("Connection closed by reader");
});

socket.on("error", (err) => {
  console.error("Error:", err);
});

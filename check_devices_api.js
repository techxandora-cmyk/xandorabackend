const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

(async () => {
  try {
    const res = await fetch("http://localhost:3000/api/v1/devices");
    const data = await res.text();
    console.log("API Response:");
    console.log(data);
  } catch (err) {
    console.error("ERR:", err.message);
  }
})();

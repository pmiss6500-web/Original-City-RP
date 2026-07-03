// ============================================================
// CR:MP-style Multiplayer Game Server (Original)
// Now with: SQLite persistence, hashed passwords, vehicles,
// map/buildings data, and a simple money/job economy.
// ============================================================
const express = require("express");
const http = require("http");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
const db = require("./db");

const app = express();
app.use(express.json());
app.use(express.static("../client"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ------------------------------------------------------------
// MAP DATA - buildings (used for collision) + job pickup point
// Original layout, simple rectangles.
// ------------------------------------------------------------
const MAP = {
  width: 1600,
  height: 1200,
  buildings: [
    { x: 100, y: 100, w: 200, h: 150, name: "City Hall" },
    { x: 500, y: 300, w: 180, h: 180, name: "Warehouse" },
    { x: 900, y: 150, w: 220, h: 140, name: "Garage" },
    { x: 300, y: 700, w: 160, h: 160, name: "Store" },
    { x: 1100, y: 600, w: 200, h: 200, name: "Office" },
  ],
  jobPoint: { x: 350, y: 780, reward: 50, label: "Delivery Job (+$50)" },
  vehicleSpawns: [
    { id: "car1", x: 950, y: 250, taken: false },
    { id: "car2", x: 250, y: 850, taken: false },
  ],
};

// ------------------------------------------------------------
// SERVER LIST API
// ------------------------------------------------------------
const SERVER_LIST = [
  { id: "srv1", name: "Original City RP", ip: "127.0.0.1", port: 3000, players: 0, maxPlayers: 50 },
];
app.get("/api/servers", (req, res) => {
  SERVER_LIST[0].players = Object.keys(players).length;
  res.json(SERVER_LIST);
});

// ------------------------------------------------------------
// AUTH - hashed passwords, persisted in SQLite
// ------------------------------------------------------------
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  if (db.getUser(username)) return res.status(400).json({ error: "Username taken" });
  const hash = await bcrypt.hash(password, 10);
  db.createUser(username, hash);
  res.json({ success: true });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = db.getUser(username);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  const player = db.getPlayer(username);
  res.json({ success: true, username, player });
});

app.get("/api/map", (req, res) => res.json(MAP));

// ------------------------------------------------------------
// REAL-TIME WORLD (Socket.io)
// ------------------------------------------------------------
const players = {}; // socket.id -> live state
const vehicles = MAP.vehicleSpawns.map(v => ({ ...v, driverId: null, x: v.x, y: v.y }));

io.on("connection", (socket) => {
  socket.on("player:join", (data) => {
    const saved = db.getPlayer(data.username) || {};
    if (data.character) db.setCharacter(data.username, data.character);

    players[socket.id] = {
      id: socket.id,
      username: data.username || "Guest",
      character: data.character || saved.character || "red",
      x: saved.x ?? 400,
      y: saved.y ?? 300,
      money: saved.money ?? 500,
      inventory: db.getInventory(data.username) || [],
      anim: "idle",
      facing: "down",
      inVehicle: null,
    };

    socket.broadcast.emit("player:new", players[socket.id]);
    socket.emit("world:state", { players, vehicles });
  });

  socket.on("player:move", (data) => {
    const p = players[socket.id];
    if (!p) return;
    p.x = data.x;
    p.y = data.y;
    p.anim = data.anim;
    p.facing = data.facing;
    db.savePlayerPosition(p.username, p.x, p.y);

    // If driving, move the vehicle too
    if (p.inVehicle) {
      const v = vehicles.find(v => v.id === p.inVehicle);
      if (v) { v.x = p.x; v.y = p.y; }
    }
    socket.broadcast.emit("player:update", p);
  });

  // Enter/exit vehicle
  socket.on("vehicle:enter", (vehicleId) => {
    const p = players[socket.id];
    const v = vehicles.find(v => v.id === vehicleId);
    if (!p || !v || v.driverId) return; // already taken
    v.driverId = socket.id;
    p.inVehicle = vehicleId;
    io.emit("vehicle:update", v);
    io.emit("player:update", p);
  });

  socket.on("vehicle:exit", (vehicleId) => {
    const p = players[socket.id];
    const v = vehicles.find(v => v.id === vehicleId);
    if (!v || v.driverId !== socket.id) return;
    v.driverId = null;
    if (p) p.inVehicle = null;
    io.emit("vehicle:update", v);
    if (p) io.emit("player:update", p);
  });

  // Simple job: player at job point requests payout (server validates distance)
  socket.on("job:complete", () => {
    const p = players[socket.id];
    if (!p) return;
    const dist = Math.hypot(p.x - MAP.jobPoint.x, p.y - MAP.jobPoint.y);
    if (dist > 60) return; // must be near the job point - anti-cheat basic check
    const newMoney = db.addMoney(p.username, MAP.jobPoint.reward);
    p.money = newMoney;
    socket.emit("job:reward", { money: newMoney, amount: MAP.jobPoint.reward });
  });

  socket.on("disconnect", () => {
    const p = players[socket.id];
    if (p && p.inVehicle) {
      const v = vehicles.find(v => v.id === p.inVehicle);
      if (v) { v.driverId = null; io.emit("vehicle:update", v); }
    }
    delete players[socket.id];
    io.emit("player:leave", socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

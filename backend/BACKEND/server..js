const express = require("express")
const cors = require("cors")
const fs = require("fs")
const path = require("path")
const multer = require("multer")

const app = express()
const PORT = 3000

app.use(cors())
app.use(express.json())
app.use("/uploads", express.static(path.join(__dirname, "../uploads")))


// ===============================
// FILE UPLOAD SETUP
// ===============================
const storage = multer.diskStorage({
 destination: function (req, file, cb) {
  cb(null, "uploads/")
 },
 filename: function (req, file, cb) {
  cb(null, Date.now() + "-" + file.originalname)
 }
})

const upload = multer({ storage: storage })


// ===============================
// UPLOAD MEMORY
// ===============================
app.post("/api/upload", upload.single("file"), (req, res) => {

 const memories = JSON.parse(
  fs.readFileSync("./database/memories.json")
 )

 const newMemory = {
  id: Date.now(),
  name: req.body.name,
  caption: req.body.caption,
  category: req.body.category,
  file: req.file.filename,
  created_at: new Date(),
  deleted: false
 }

 memories.push(newMemory)

 fs.writeFileSync(
  "./database/memories.json",
  JSON.stringify(memories, null, 2)
 )

 res.json({ success: true })

})


// ===============================
// GET MEMORIES
// ===============================
app.get("/api/memories", (req, res) => {

 const memories = JSON.parse(
  fs.readFileSync("./database/memories.json")
 )

 const filtered = memories.filter(m => !m.deleted)

 res.json(filtered)

})


// ===============================
// PAGINATION
// ===============================
app.get("/api/memories/page/:page", (req, res) => {

 const page = parseInt(req.params.page) || 1
 const limit = 20
 const start = (page - 1) * limit

 const memories = JSON.parse(
  fs.readFileSync("./database/memories.json")
 )

 const filtered = memories.filter(m => !m.deleted)

 const result = filtered.slice(start, start + limit)

 res.json(result)

})


// ===============================
// EDIT MEMORY
// ===============================
app.patch("/api/memory/:id", (req, res) => {

 const memories = JSON.parse(
  fs.readFileSync("./database/memories.json")
 )

 const memory = memories.find(m => m.id == req.params.id)

 if (!memory) {
  return res.status(404).json({ error: "Memory not found" })
 }

 memory.caption = req.body.caption || memory.caption
 memory.category = req.body.category || memory.category

 fs.writeFileSync(
  "./database/memories.json",
  JSON.stringify(memories, null, 2)
 )

 res.json({ success: true })

})


// ===============================
// SOFT DELETE
// ===============================
app.delete("/api/memory/:id", (req, res) => {

 const memories = JSON.parse(
  fs.readFileSync("./database/memories.json")
 )

 const memory = memories.find(m => m.id == req.params.id)

 if (!memory) {
  return res.status(404).json({ error: "Memory not found" })
 }

 memory.deleted = true

 fs.writeFileSync(
  "./database/memories.json",
  JSON.stringify(memories, null, 2)
 )

 res.json({ success: true })

})


// ===============================
// BULK CATEGORY CHANGE
// ===============================
app.post("/api/admin/bulk-category", (req, res) => {

 const { ids, category } = req.body

 const memories = JSON.parse(
  fs.readFileSync("./database/memories.json")
 )

 ids.forEach(id => {

  const memory = memories.find(m => m.id == id)

  if (memory) {
   memory.category = category
  }

 })

 fs.writeFileSync(
  "./database/memories.json",
  JSON.stringify(memories, null, 2)
 )

 res.json({ success: true })

})


// ===============================
// CSV EXPORT
// ===============================
app.get("/api/admin/export", (req, res) => {

 const memories = JSON.parse(
  fs.readFileSync("./database/memories.json")
 )

 let csv = "Name,Caption,Category,Date\n"

 memories.forEach(m => {

  csv += `${m.name},${m.caption},${m.category},${m.created_at}\n`

 })

 res.setHeader("Content-Type", "text/csv")

 res.setHeader(
  "Content-Disposition",
  "attachment; filename=memories.csv"
 )

 res.send(csv)

})


// ===============================
app.listen(PORT, () => {
 console.log("Server running on port " + PORT)
})
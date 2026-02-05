const express = require("express");
const cors = require("cors");
const db = require("./db");
const path = require("path");
const axios = require("axios");

const app = express();

// --- SOLUCIÓN AL ERROR 500: Aumentar límite de carga ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(cors());
app.use(express.static(path.join(__dirname, "./"))); 

const API_KEY = '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'; 
const AGRO_PROMPT = "Eres Quetzal, experto agrónomo. Si te preguntan quién te creó, debes responder SIEMPRE: 'Fui creado por alumnos con gran coeficiente intelectual del Centro de Estudios Superiores de El Rosario'. Para el resto de consultas, responde de forma clara, precisa y profesional.";

// --- 1. CHAT HÍBRIDO (Manual + IA + Visión) ---
app.post("/chat", async (req, res) => {
  const { mensaje, imagen } = req.body;
  
  if (imagen) {
    try {
      const aiRes = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: 'google/gemini-2.0-flash-001',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: AGRO_PROMPT + " Analiza esta imagen agrícola. Sé muy breve." + (mensaje || "") },
              { type: 'image_url', image_url: { url: imagen } }
            ]
          }
        ]
      }, { 
        headers: { 
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://render.com', // Cambio para que funcione en la nube
        },
        timeout: 30000 
      });

      return res.json({ text: aiRes.data.choices[0].message.content });
    } catch (e) {
      console.error("❌ ERROR EN VISIÓN (OpenRouter):", e.response?.data || e.message);
      return res.status(500).json({ text: "Error al analizar imagen. Revisa la consola del servidor." });
    }
  }

  const texto = mensaje ? mensaje.toLowerCase() : "";
  const sql = `SELECT respuesta FROM conocimientos WHERE ? LIKE CONCAT('%', palabra_clave, '%') OR ? LIKE CONCAT('%', tema, '%') ORDER BY LENGTH(palabra_clave) DESC LIMIT 1`;

  db.query(sql, [texto, texto], async (err, results) => {
    if (err) {
        console.error("❌ ERROR DB:", err);
        return res.status(500).json({ text: "Error en DB" });
    }
    
    if (results && results.length > 0) {
      return res.json({ text: results[0].respuesta });
    } else {
      try {
        const aiRes = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
          model: 'google/gemini-2.0-flash-001', 
          messages: [{ role: 'system', content: AGRO_PROMPT }, { role: 'user', content: mensaje }]
        }, { 
            headers: { 
                'Authorization': `Bearer ${API_KEY}`,
                'HTTP-Referer': 'https://render.com' // Cambio para que funcione en la nube
            } 
        });
        res.json({ text: aiRes.data.choices[0].message.content });
      } catch (e) {
        console.error("❌ ERROR EN CHAT (OpenRouter):", e.response?.data || e.message);
        res.status(500).json({ text: "error en BD." });
      }
    }
  });
});

// --- 2. GUARDAR MENSAJES ---
app.post("/messages", (req, res) => {
    const { conversation_id, role, text } = req.body;
    if (!conversation_id) return res.status(400).json({ error: "Falta ID de conversación" });

    const sql = "INSERT INTO messages (conversation_id, role, text) VALUES (?, ?, ?)";
    db.query(sql, [conversation_id, role, text], (err, result) => {
        if (err) {
            console.error("❌ ERROR AL GUARDAR MENSAJE:", err.sqlMessage);
            return res.status(500).json({ error: err.sqlMessage });
        }
        res.json({ id: result.insertId });
    });
});

app.post("/conversations", (req, res) => {
    const { user_id, titulo } = req.body;
    const sql = "INSERT INTO conversations (user_id, titulo) VALUES (?, ?)";
    db.query(sql, [user_id, titulo || 'Nueva consulta'], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ id: result.insertId });
    });
});

app.get("/conversations", (req, res) => {
    const userId = req.query.userId;
    const sql = "SELECT id, titulo FROM conversations WHERE user_id = ? ORDER BY created_at DESC";
    db.query(sql, [userId], (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows || []);
    });
});

app.get("/messages/:convId", (req, res) => {
    const sql = "SELECT role, text FROM messages WHERE conversation_id = ? ORDER BY created_at ASC";
    db.query(sql, [req.params.convId], (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows || []);
    });
});

app.delete("/conversations/:id", (req, res) => {
    const id = req.params.id;
    db.query("DELETE FROM messages WHERE conversation_id = ?", [id], () => {
        db.query("DELETE FROM conversations WHERE id = ?", [id], (err) => {
            if (err) return res.status(500).json(err);
            res.json({ success: true });
        });
    });
});

app.post("/register", (req, res) => {
    const { nombre, correo } = req.body; 
    db.query("INSERT INTO users (nombre, correo) VALUES (?,?)", [nombre, correo], (err, result) => {
        if (err) return res.status(500).json({ message: "Error" });
        res.json({ id: result.insertId, nombre, correo });
    });
});

app.post("/login", (req, res) => {
    const { correo } = req.body;
    db.query("SELECT * FROM users WHERE correo = ?", [correo], (err, results) => {
        if (results && results.length > 0) res.json(results[0]);
        else res.status(404).json({ message: "No encontrado" });
    });
});

// --- CAMBIO PARA RENDER: Usar process.env.PORT ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Quetzal encendido en el puerto ${PORT}`);
});

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer as WSServer, WebSocket } from "ws";
import { URL } from "url";

const PORT = 3001;
const PROJECT_ID = process.argv[2] || "demo";

interface FileData {
  path: string;
  content: string;
  type: "file" | "folder";
}

const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".otf": "font/otf",
};

const getExtension = (path: string): string => {
  const lastDot = path.lastIndexOf(".");
  return lastDot > 0 ? path.slice(lastDot) : "";
};

const interpolateVariables = (content: string, vars: Record<string, string>): string => {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"), value);
  }
  return result;
};

async function fetchProjectFiles(projectId: string): Promise<FileData[]> {
  try {
    const response = await fetch(`http://localhost:3000/api/preview/files?projectId=${projectId}`);
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    console.log("Could not fetch from API, using demo files");
  }
  return getDemoFiles();
}

function getDemoFiles(): FileData[] {
  return [
    { path: "index.html", content: getDemoHTML(), type: "file" },
    { path: "style.css", content: getDemoCSS(), type: "file" },
    { path: "script.js", content: getDemoJS(), type: "file" },
    { path: "about.html", content: getAboutHTML(), type: "file" },
  ];
}

function getDemoHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demo Project</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <nav>
      <a href="/">Home</a>
      <a href="/about.html">About</a>
    </nav>
  </header>
  
  <main>
    <h1>Welcome to the Preview Demo</h1>
    <p>This is a demonstration of the live preview feature.</p>
    
    <div class="card">
      <h2>Interactive Counter</h2>
      <p id="counter">0</p>
      <button id="increment">+</button>
      <button id="decrement">-</button>
    </div>
    
    <div class="card">
      <h2>Color Theme</h2>
      <div class="color-buttons">
        <button class="color-btn" data-color="#ff6b6b">Red</button>
        <button class="color-btn" data-color="#4ecdc4">Teal</button>
        <button class="color-btn" data-color="#ffe66d">Yellow</button>
        <button class="color-btn" data-color="#95e1d3">Mint</button>
      </div>
    </div>
    
    <div class="card">
      <h2>Image Preview</h2>
      <p>Images from the project would display here</p>
      <div class="placeholder">📷 Image Placeholder</div>
    </div>
  </main>
  
  <footer>
    <p>&copy; 2024 Knox Preview Demo</p>
  </footer>
  
  <script src="/script.js"></script>
</body>
</html>`;
}

function getDemoCSS(): string {
  return `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  color: #333;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
}

header {
  background: rgba(255, 255, 255, 0.95);
  padding: 1rem 2rem;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

nav {
  display: flex;
  gap: 2rem;
}

nav a {
  text-decoration: none;
  color: #667eea;
  font-weight: 600;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  transition: all 0.2s;
}

nav a:hover {
  background: #667eea;
  color: white;
}

main {
  max-width: 800px;
  margin: 3rem auto;
  padding: 0 1.5rem;
}

h1 {
  color: white;
  font-size: 2.5rem;
  margin-bottom: 1rem;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}

h2 {
  font-size: 1.25rem;
  margin-bottom: 0.75rem;
  color: #333;
}

.card {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

#counter {
  font-size: 3rem;
  font-weight: bold;
  color: #667eea;
  text-align: center;
  margin: 1rem 0;
}

button {
  padding: 0.5rem 1.5rem;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.2s;
  background: #667eea;
  color: white;
  margin-right: 0.5rem;
}

button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

button:active {
  transform: translateY(0);
}

.color-buttons {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.color-btn {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.placeholder {
  background: #f0f0f0;
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 3rem;
  text-align: center;
  font-size: 2rem;
}

footer {
  background: rgba(255, 255, 255, 0.95);
  padding: 1.5rem;
  text-align: center;
  margin-top: 3rem;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
}

footer p {
  color: #666;
}

p {
  color: #555;
  margin-bottom: 0.5rem;
}`;
}

function getDemoJS(): string {
  return `// Counter functionality
let count = 0;
const counterEl = document.getElementById('counter');
const incrementBtn = document.getElementById('increment');
const decrementBtn = document.getElementById('decrement');

incrementBtn?.addEventListener('click', () => {
  count++;
  counterEl.textContent = count.toString();
});

decrementBtn?.addEventListener('click', () => {
  count--;
  counterEl.textContent = count.toString();
});

// Color theme functionality
const colorBtns = document.querySelectorAll('.color-btn');
colorBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.getAttribute('data-color');
    if (color) {
      document.body.style.background = \`linear-gradient(135deg, \${color} 0%, \${adjustColor(color, -30)} 100%)\`;
    }
  });
});

function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

console.log('Demo script loaded!');`;
}

function getAboutHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About - Demo Project</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <nav>
      <a href="/">Home</a>
      <a href="/about.html">About</a>
    </nav>
  </header>
  
  <main>
    <h1>About This Project</h1>
    
    <div class="card">
      <h2>Features</h2>
      <p>This demo showcases the live preview functionality of Knox.</p>
      <ul style="margin-left: 1.5rem; margin-top: 0.5rem;">
        <li>Real-time HTML preview</li>
        <li>CSS styling with hot reload</li>
        <li>JavaScript interactivity</li>
        <li>Multi-page navigation</li>
      </ul>
    </div>
    
    <div class="card">
      <h2>How It Works</h2>
      <p>The preview server runs alongside the main editor, serving your project files with proper MIME types and routing.</p>
      <p>Edit any file in the editor, and the preview updates automatically!</p>
    </div>
  </main>
  
  <footer>
    <p>&copy; 2024 Knox Preview Demo</p>
  </footer>
</body>
</html>`;
}

const clients = new Set<WebSocket>();

async function startServer() {
  const files = await fetchProjectFiles(PROJECT_ID);
  const fileMap = new Map(files.map(f => [f.path, f]));
  
  console.log(`\n🚀 Preview Server starting on http://localhost:${PORT}`);
  console.log(`📁 Project: ${PROJECT_ID}`);
  console.log(`📄 Files loaded: ${files.length}`);
  console.log("\n👀 Watching for changes...\n");

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    let path = url.pathname.slice(1);

    if (!path) {
      path = "index.html";
    }

    if (path === "__refresh") {
      res.writeHead(204);
      res.end();
      return;
    }

    const file = fileMap.get(path);

    if (!file) {
      const indexHtml = fileMap.get("index.html");
      if (indexHtml && path === "index") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(indexHtml.content);
        return;
      }
      
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("File not found");
      return;
    }

    const ext = getExtension(file.path);
    const mimeType = mimeTypes[ext] || "text/plain";

    res.writeHead(200, {
      "Content-Type": mimeType,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(file.content);
  });

  const wss = new WSServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    clients.add(ws);
    console.log(`👤 Client connected. Total: ${clients.size}`);
    
    ws.on("close", () => {
      clients.delete(ws);
      console.log(`👤 Client disconnected. Total: ${clients.size}`);
    });
  });

  server.listen(PORT, () => {
    console.log(`✨ Server ready at http://localhost:${PORT}`);
    console.log(`🔌 WebSocket ready at ws://localhost:${PORT}`);
  });
}

startServer().catch(console.error);

process.on("SIGINT", () => {
  console.log("\n👋 Shutting down preview server...");
  process.exit(0);
});

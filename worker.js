/**
 * R2 Cloud Drive — 个人网盘 (Cloudflare Worker + R2)
 *
 * 部署需要(在 Cloudflare 后台操作):
 *  1. 创建一个 R2 存储桶,例如 my-drive
 *  2. 创建 Worker,把本文件内容粘贴进去(或用 wrangler 部署)
 *  3. Worker 绑定 R2:变量名填 DRIVE,选你的存储桶
 *  4. Worker 加 Secret:名字 PASSWORD,值就是你的登录密码
 *  5. 部署,访问 Worker 域名即可
 */

const COOKIE = "r2drive_auth";

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function authed(req, env) {
  if (!env.PASSWORD) return false;
  const c = req.headers.get("Cookie") || "";
  const m = c.match(new RegExp(COOKIE + "=([a-f0-9]{64})"));
  if (!m) return false;
  return m[1] === (await sha256hex("r2drive:" + env.PASSWORD));
}

// 清理 key,防 ../ 穿越
function cleanKey(k) {
  return (k || "")
    .replace(/^\/+/, "")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function loginPage() {
  return new Response(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录 · R2 网盘</title>
<style>
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
background:#f5f6f8;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
.card{background:#fff;padding:32px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);width:300px}
h2{margin:0 0 20px;text-align:center;font-weight:600}
input{width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box}
button{width:100%;margin-top:12px;padding:10px;border:0;border-radius:8px;background:#1a73e8;color:#fff;font-size:15px}
.err{color:#d93025;font-size:13px;margin-top:8px;min-height:18px;text-align:center}
</style></head><body>
<div class="card"><h2>R2 网盘</h2>
<input id="pw" type="password" placeholder="输入密码" onkeydown="if(event.key==='Enter')login()">
<div class="err" id="err"></div>
<button onclick="login()">进入</button></div>
<script>
async function login(){
  const password=document.getElementById('pw').value;
  const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({password})});
  if(r.ok){location.href='/'}else{document.getElementById('err').textContent='密码不对';}
}
</script></body></html>`,
    { headers: { "Content-Type": "text/html;charset=utf-8" } }
  );
}

function appPage() {
  return new Response(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>R2 网盘</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
background:#f5f6f8;margin:0;padding:0}
.bar{background:#1a73e8;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
.bar b{font-size:17px}
.bar button{background:rgba(255,255,255,.2);border:0;color:#fff;padding:6px 12px;border-radius:6px}
.wrap{max-width:720px;margin:0 auto;padding:12px}
.crumb{background:#fff;padding:10px 14px;border-radius:8px;margin-bottom:10px;font-size:14px;overflow-x:auto;white-space:nowrap}
.crumb a{color:#1a73e8;text-decoration:none}
.tools{display:flex;gap:8px;margin-bottom:10px}
.tools button,.tools label{flex:1;padding:10px;border:0;border-radius:8px;background:#fff;font-size:14px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.tools label{color:#1a73e8;cursor:pointer}
.item{background:#fff;padding:12px 14px;border-radius:8px;margin-bottom:8px;display:flex;align-items:center;gap:10px}
.item .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.item .s{color:#888;font-size:12px;white-space:nowrap}
.item button{border:0;border-radius:6px;padding:6px 10px;font-size:13px}
.dl{background:#e8f0fe;color:#1a73e8}
.del{background:#fce8e6;color:#d93025}
.folder{color:#1a73e8;font-weight:500}
#prog{display:none;background:#fff;padding:10px 14px;border-radius:8px;margin-bottom:10px;font-size:13px}
</style></head><body>
<div class="bar"><b>R2 网盘</b><button onclick="logout()">退出</button></div>
<div class="wrap">
<div class="crumb" id="crumb"></div>
<div class="tools">
<label>📤 上传文件<input id="up" type="file" multiple style="display:none"></label>
<button onclick="mkdir()">📁 新建文件夹</button>
</div>
<div id="prog"></div>
<div id="list"></div>
</div>
<script>
let prefix='';
function fmtSize(b){if(b<1024)return b+' B';if(b<1048576)return (b/1024).toFixed(1)+' KB';if(b<1073741824)return (b/1048576).toFixed(1)+' MB';return (b/1073741824).toFixed(2)+' GB'}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;')}
async function load(){
  const r=await fetch('/api/list?prefix='+encodeURIComponent(prefix));
  if(r.status===401){location.href='/';return}
  const d=await r.json();
  let c='<a href="#" onclick="go(\\'\\');return false">根目录</a>';
  if(prefix){let acc='';prefix.split('/').filter(Boolean).forEach(p=>{acc+=p+'/';c+=' / <a href="#" onclick="go(\\''+acc+'\\');return false">'+esc(p)+'</a>'})}
  document.getElementById('crumb').innerHTML=c;
  let h='';
  d.folders.forEach(f=>{const name=f.slice(prefix.length).replace(/\\/$/,'');
    h+='<div class="item"><span class="n folder">📁 '+esc(name)+'</span><button class="dl" onclick="go(\\''+f+'\\')">进入</button><button class="del" onclick="rmdir(\\''+f+'\\')">删除</button></div>'});
  d.files.forEach(f=>{const name=f.key.slice(prefix.length);
    h+='<div class="item"><span class="n">📄 '+esc(name)+'</span><span class="s">'+fmtSize(f.size)+'</span><button class="dl" onclick="dl(\\''+f.key+'\\')">下载</button><button class="del" onclick="rm(\\''+f.key+'\\')">删除</button></div>'});
  document.getElementById('list').innerHTML=h||'<div class="item"><span class="n" style="color:#888">空文件夹</span></div>';
}
function go(p){prefix=p;load()}
function dl(k){location.href='/api/download?key='+encodeURIComponent(k)}
async function rm(k){if(!confirm('删除 '+k.split('/').pop()+' ?'))return;
  await fetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:k})});load()}
async function rmdir(p){if(!confirm('删除文件夹 '+p+' 及里面所有文件?'))return;
  await fetch('/api/rmdir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefix:p})});load()}
async function mkdir(){const n=prompt('文件夹名');if(!n)return;
  await fetch('/api/mkdir',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({prefix:prefix+n.replace(/\\//g,'')+'/'})});load()}
async function logout(){await fetch('/api/logout',{method:'POST'});location.href='/'}
document.getElementById('up').addEventListener('change',async e=>{
  const files=e.target.files;if(!files.length)return;
  const prog=document.getElementById('prog');prog.style.display='block';
  for(const f of files){
    prog.textContent='上传中: '+f.name;
    const r=await fetch('/api/upload?key='+encodeURIComponent(prefix+f.name),{method:'PUT',body:f});
    if(!r.ok){prog.textContent='上传失败: '+f.name;break}
  }
  prog.style.display='none';e.target.value='';load();
});
load();
</script></body></html>`,
    { headers: { "Content-Type": "text/html;charset=utf-8" } }
  );
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (!env.PASSWORD) {
      return new Response("请先在 Worker 设置 Secret: PASSWORD(登录密码),再绑定 R2 存储桶(变量名 DRIVE)", {
        status: 500,
      });
    }
    if (!env.DRIVE) {
      return new Response("请先绑定 R2 存储桶,变量名 DRIVE", { status: 500 });
    }

    // 登录页 / 主页
    if (path === "/" || path === "/index.html") {
      return (await authed(req, env)) ? appPage() : loginPage();
    }

    // 登录接口
    if (path === "/api/login" && req.method === "POST") {
      const { password } = await req.json().catch(() => ({}));
      if (password === env.PASSWORD) {
        const token = await sha256hex("r2drive:" + env.PASSWORD);
        return json({ ok: true }, 200, {
          "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
        });
      }
      return json({ ok: false }, 401);
    }

    // 以下接口都要登录
    if (!(await authed(req, env))) return json({ error: "unauthorized" }, 401);

    if (path === "/api/logout" && req.method === "POST") {
      return json({ ok: true }, 200, {
        "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`,
      });
    }

    // 列文件
    if (path === "/api/list") {
      const prefix = cleanKey(url.searchParams.get("prefix") || "");
      const pre = prefix ? (prefix.endsWith("/") ? prefix : prefix + "/") : "";
      const res = await env.DRIVE.list({ prefix: pre, delimiter: "/" });
      const folders = (res.delimitedPrefixes || []).sort();
      const files = (res.objects || [])
        .filter((o) => o.key !== pre)
        .map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded }))
        .sort((a, b) => a.key.localeCompare(b.key));
      return json({ folders, files });
    }

    // 上传(整个文件做 body, key 放 query)
    if (path === "/api/upload" && req.method === "PUT") {
      const key = cleanKey(url.searchParams.get("key") || "");
      if (!key || key.endsWith("/")) return json({ error: "bad key" }, 400);
      await env.DRIVE.put(key, req.body);
      return json({ ok: true, key });
    }

    // 下载
    if (path === "/api/download") {
      const key = cleanKey(url.searchParams.get("key") || "");
      const obj = await env.DRIVE.get(key);
      if (!obj) return json({ error: "not found" }, 404);
      const name = encodeURIComponent(key.split("/").pop());
      return new Response(obj.body, {
        headers: {
          "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${name}`,
        },
      });
    }

    // 删除文件
    if (path === "/api/delete" && req.method === "POST") {
      const { key } = await req.json().catch(() => ({}));
      const k = cleanKey(key || "");
      if (!k) return json({ error: "bad key" }, 400);
      await env.DRIVE.delete(k);
      return json({ ok: true });
    }

    // 删除文件夹(含里面所有文件)
    if (path === "/api/rmdir" && req.method === "POST") {
      const { prefix } = await req.json().catch(() => ({}));
      const pre = cleanKey(prefix || "");
      if (!pre) return json({ error: "bad prefix" }, 400);
      const p = pre.endsWith("/") ? pre : pre + "/";
      let cursor;
      do {
        const res = await env.DRIVE.list({ prefix: p, cursor });
        for (const o of res.objects || []) await env.DRIVE.delete(o.key);
        cursor = res.truncated ? res.cursor : undefined;
      } while (cursor);
      return json({ ok: true });
    }

    // 新建文件夹
    if (path === "/api/mkdir" && req.method === "POST") {
      const { prefix } = await req.json().catch(() => ({}));
      const p = cleanKey(prefix || "");
      if (!p) return json({ error: "bad prefix" }, 400);
      await env.DRIVE.put(p.endsWith("/") ? p : p + "/", "");
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  },
};

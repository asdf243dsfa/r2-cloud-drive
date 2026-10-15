# R2 Cloud Drive · 个人网盘

跑在 Cloudflare Worker + R2 上的个人网盘:文件列表、上传、下载、新建文件夹、删除,手机浏览器直接用,密码登录。

## 部署(在 Cloudflare 后台操作,约 5 分钟)

1. **建 R2 存储桶**:Cloudflare 后台 → R2 → 创建存储桶,例如 `my-drive`。
2. **建 Worker**:Workers → 创建 → Hello World 模板,把 `worker.js` 的全部内容粘贴进去,保存部署。
   (也可用 wrangler:`wrangler deploy`,先把 `wrangler.toml` 里的 bucket_name 换成你的)
3. **绑定 R2**:Worker → Settings → Bindings → Add → R2 Bucket,**变量名填 `DRIVE`**,选你的存储桶。
4. **设密码**:Worker → Settings → Variables → Add Secret,**名字 `PASSWORD`**,值就是你的登录密码(点 Encrypt 保存)。
5. 访问 Worker 给你的域名(`xxx.workers.dev`),输密码进入。

## 说明
- 文件存在你自己的 R2 存储桶里,Worker 只做转发,不经过第三方。
- 登录态用 Cookie 保持 30 天,密码哈希比对,不存明文。
- 超大文件受 Worker 套餐请求大小限制,日常文档照片视频没问题。

## License
MIT

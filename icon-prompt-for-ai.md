# S3 Client 应用图标生成提示词

## 应用信息
- **应用名称**: S3 Client
- **应用类型**: AWS S3 云存储管理桌面应用
- **平台**: macOS (Electron 应用)

## 图标要求

### 1. 核心主题
- 云存储 + AWS S3 元素
- 专业、现代、简洁的设计风格
- 科技感，体现数据/云/存储概念

### 2. 建议设计方向（任选其一）
- **方向A**: 云朵 + 存储桶(bucket)的组合
- **方向B**: S3 字样 + 云元素
- **方向C**: 抽象的数据立方体/层叠方块，体现分层存储
- **方向D**: 云朵 + 向上/向下箭头，体现上传下载

### 3. 风格要求
- **扁平化设计** (Flat Design)，适合 macOS Big Sur 风格
- 渐变色彩或纯色均可
- 圆角矩形背景或圆形背景
- 图标在中间，留有适当的内边距

### 4. 配色建议
- 主色调: AWS 橙色 (#FF9900) 或 科技蓝 (#2563EB)
- 背景: 深色 (#1F2937) 或 浅色 (#FFFFFF)
- 确保高对比度，在任何背景上清晰可见

### 5. 技术规格
- **必须**: 生成 1024x1024 像素的 PNG 文件
- **格式**: 透明背景 PNG
- **文件名**: `icon.png`

### 6. 图标结构
```
┌─────────────────┐
│                 │
│    [图标主体]    │  <- 云/桶/S3等元素
│                 │
│                 │
└─────────────────┘
      1024x1024
```

### 7. 不需要的元素
- 避免过于复杂的细节（小尺寸会看不清）
- 避免文字过多（建议只保留图形元素）
- 避免渐变过多（最多 2-3 种颜色）

### 8. 参考描述
"Create a modern, flat-style app icon for an S3 cloud storage client application. 
The icon should feature a stylized cloud with a storage bucket element, using 
AWS orange (#FF9900) as the primary color on a dark navy blue (#1F2937) rounded 
rectangle background. The design should be clean, professional, and suitable for 
a macOS application. Include subtle depth but keep it minimalist. Output as a 
1024x1024px PNG with transparent background."

---

## 生成后处理
生成 PNG 后，需要在 macOS 终端转换为 `.icns` 格式：

```bash
cd /Users/wangchuxiang/IdeaProjects/s3-client/build
mkdir icon.iconset
sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32 icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64 icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset
```

转换后的 `icon.icns` 放入 `build/` 文件夹即可。

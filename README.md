# ramda lab tools

ブラウザの中だけで動く、画像と PDF の小さな無料ツールです。ファイルをどこにも送信しません(各ページのコードはネットワーク通信をしません)。

Small, free image and PDF tools that run entirely in your browser. The page code never uploads your files.

| ツール | 使う | できること |
| --- | --- | --- |
| HEIC・WebP・AVIF を JPG に一括変換 | https://lab.ramda.io/image-convert/ | iPhone の HEIC も変換(Safari と、HEVC を復号できる Chrome) |
| 画像圧縮(一括・KB 指定) | https://lab.ramda.io/image-compress-kb/ | 「200KB 以下」のように容量を指定して圧縮 |
| 画像サイズ変更と証明写真サイズ | https://lab.ramda.io/image-resize/ | マイナンバー、パスポート、履歴書の規格のプリセット |
| 画像の連番リネームと ZIP 保存 | https://lab.ramda.io/image-renamer/ | 並べ替えて 001、002…の名前で一括保存 |
| PDF を結合 | https://lab.ramda.io/pdf-merge/ | PDF と画像を並べ替えて 1 つにまとめる |

## 仕組み

- 各ツールは 1 つの HTML ファイルです。ビルドは不要で、`tools/<name>/index.html` を開けば動きます
- HEIC の読み取りは、HEIF の入れ物を自前で解析し、HEVC の復号はブラウザと OS の機能(WebCodecs)に任せています。コーデックは同梱していません
- PDF の処理には pdf-lib(MIT)を同梱しています

## ライセンス

MIT(同梱のライブラリは各ライセンスに従います)。

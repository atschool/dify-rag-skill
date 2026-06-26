---
name: dify-rag-inject
description: Google Drive上の資料（特に画像主体のPDFスライド）をDifyのナレッジベースにRAG化して投入する。ユーザーが「Driveの〇〇をDifyに入れて」「この資料をRAG化して」「ナレッジに追加して」などと依頼したときに使う。Drive MCPでの取得、画像PDFの画像化とVision読み取り、整形Markdown化、ワークフローAPIでの投入までを一貫して行う。
---

# Drive資料 → Dify RAG投入

Google Drive上の資料をDifyナレッジベースに投入するためのskill。対象は主に**画像主体のPDF**（スライドをPDF化した、テキストレイヤーの無い資料）。テキストPDFやGoogleドキュメントはより簡単に処理できる（最後の補足参照）。

整形（読み取り）はこのClaude Code自身が行う。外部のClaude APIには投げない。

## 前提

- Google Drive MCP が接続済み
- `pdftoppm`（poppler）が使える（無ければ `brew install poppler`）
- このskillフォルダに `dify_inject.py` と `config` が同梱されている
- `config` に `DIFY_BASE_URL` と `DIFY_APP_KEY` が記入済み（install.sh で生成、ユーザーがキーを記入）
- Dify側で「ナレッジ投入パイプライン」ワークフローが公開済み

## 全体フロー

```
Drive MCPで取得 → 画像主体か判定 → 画像化(pdftoppm) → Vision整形(自分で読む) → 投入(dify_inject.py)
```

---

## STEP 1: 対象をDriveで特定

Drive MCPの `search_files` で対象を探す。`fileId` を控える。候補が複数ならユーザーに確認する。

## STEP 2: テキストレイヤーの有無を判定

`read_file_content` を試す。
- テキストが返る → テキストPDF/ドキュメント。STEP 3〜4を飛ばし STEP 5（整形）へ。
- 空が返る → 画像主体PDF。STEP 3へ。

## STEP 3: 取得して画像化（画像主体PDFのみ）

### 3-1. base64取得 → PDF復元
`download_file_content` で取得。結果が大きい場合はツール結果ファイルに保存される。

⚠️ **入れ子JSON**: download結果は二重にJSONが入れ子。最上位は配列 `[{type, text}]`、その `text` の中身が**さらにJSON文字列**で、PDFのbase64は `content` フィールドにある（先頭 `JVBERi` = PDF署名）。

```python
import json, base64
with open('<ツール結果JSONパス>') as f:
    data = json.load(f)
inner = json.loads(data[0]['text'])      # textの中がさらにJSON
pdf = base64.b64decode(inner['content'])  # contentがPDF本体
open('source.pdf','wb').write(pdf)
```

### 3-2. 画像主体か再確認（任意）
```bash
pdffonts source.pdf | head     # emb列が全てno
pdftotext source.pdf - | head  # 中身が空(\fのみ)なら画像主体で確定
```

### 3-3. 画像化
```bash
mkdir -p pages
pdftoppm -jpeg -r 130 source.pdf pages/page   # pages/page-01.jpg ...
```
表が細かく読めなければ `-r 180`〜`200` に上げる。

## STEP 4: 自分で画像を読む（Vision整形）

⚠️ **画像サイズ制限**: viewは8000px超の画像を弾く。**横1100pxにリサイズして2ページずつ縦連結**すると効率的（約1100×1244px）。

```python
from PIL import Image
def stack(pages, out, w=1100):
    ims=[Image.open(f'pages/page-{p:02d}.jpg') for p in pages]
    rs=[im.resize((w,int(im.height*w/im.width))) for im in ims]
    h=sum(i.height for i in rs)+8*(len(rs)-1)
    c=Image.new('RGB',(w,h),'white'); y=0
    for im in rs: c.paste(im,(0,y)); y+=im.height+8
    c.save(out,quality=90)
```
連結画像を順にviewで開き、内容を漏れなく読み取る。表・数字・固有名詞は正確に。

## STEP 5: 整形Markdownを書く（RAG最適化）

整形の質が検索精度に直結する。

1. **冒頭にメタ情報**: 資料名・作成元・種別・問い合わせ先を1〜3行（検索アンカー）。
2. **見出しで意味の塊を分ける**（`##` `###`）。1チャンク1トピック。
3. **数字・料金・条件・期日は必ず表に**する。質問が当たりやすくなる。箇条書きに埋もれさせない。
4. **固有名詞・略称は省略しない**（検索キーワードになる）。
5. **グラフ・画像は数値を文章化**（「グラフ参照」ではなく実数値を起こす）。
6. 1ファイル=1資料。分割せず1つのMarkdownに（チャンク化はDify側がやる）。

`<doc_name>_整形版.md` で保存。

## STEP 6: categoryを決める

categoryは**Difyナレッジ（器）の名前**になる。同じcategory→同じ器、新しいcategory→器が自動新規作成（ワークフローのIF/ELSE分岐）。

- 粒度は「部署 > 中分類」の**中分類単位**。
- 手入力。迷う場合はユーザーに候補を出して確認する。

## STEP 7: 投入

```bash
python3 "$HOME/.claude/skills/dify-rag-inject/dify_inject.py" \
    --category '<カテゴリ名>' \
    --doc-name '<doc_name>' \
    --file './<doc_name>_整形版.md'
```
- APIキー・ベースURLは同梱 `config` から自動で読まれる。
- `--dry-run` で送信せず内容確認のみ。
- 成功で `status: succeeded` / `✅ 投入成功`。
- 同じ category・doc_name で再投入すると **UPSERT**（上書き更新）。重複は作られない。

### 投入後の確認をユーザーに促す
- Difyナレッジ画面に指定category名の器ができたか
- その器に doc_name のドキュメントが入りチャンク化されたか

---

## トラブル時（諦めず最低3経路）

| 症状 | 原因 | 対処 |
|---|---|---|
| `401` | APIキー誤り/未設定 | `config` の `DIFY_APP_KEY` を確認 |
| 接続エラー | DifyのURLに届かない | Dify起動・同一LAN・`curl <BASE_URL>` で疎通確認 |
| `400 Workflow not published` | ワークフロー未公開 | Difyで「公開する」を押す |
| `read_file_content` が空 | 画像主体PDF | 正常。STEP 3へ |
| 表の数字が潰れる | dpi不足 | `pdftoppm -r 180`〜`200` で再画像化 |
| download結果が読めない | 入れ子JSON | STEP 3-1の通り `data[0]['text']` を再度 `json.loads` |

全滅したら、何が・なぜ弾かれ・ユーザーが何をすれば解決するかをまとめて提示する。

## 補足: テキストPDF/Googleドキュメント
STEP 2で `read_file_content` がテキストを返したら画像化・Visionは不要。そのテキストをSTEP 5の規約で整形し、STEP 7で投入するだけ。

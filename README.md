# dify-rag-skill

Google Drive 上の資料を Dify のナレッジベースに RAG 化して投入する Claude Code skill。
画像主体の PDF スライドも、Claude Code が中身を読み取って整形したうえで投入する。

## これは何をするものか

Claude Code に「Drive の〇〇を Dify に入れて」と依頼すると、

1. Google Drive から対象資料を取得
2. 画像主体 PDF なら画像化して Claude Code 自身が内容を読み取り
3. RAG 検索に強い Markdown に整形
4. Dify の投入ワークフロー API を叩いてナレッジベースに登録（器の自動作成・UPSERT 込み）

までを一貫して行う。

## 前提

- **Claude Code** が使えること
- **Google Drive MCP** が Claude Code に接続済みであること
- **Dify** で「ナレッジ投入パイプライン」ワークフローが公開済みであること
- ワークフロー用 **API キー** を発行済みであること
- **poppler**（`pdftoppm`）が入っていること（未導入なら `brew install poppler`）

### APIキーの発行方法
Dify で対象ワークフローアプリを開き、「APIアクセス」からAPIキーを作成してコピーしておく。

## インストール

```bash
git clone <このリポジトリのURL>
cd dify-rag-skill
./install.sh
```

`install.sh` が次を行う:
- `~/.claude/skills/dify-rag-inject/` に skill 一式を配置
- `pdftoppm` の有無をチェック
- `config` を生成

最後に、生成された `~/.claude/skills/dify-rag-inject/config` を開き、
**Dify のベースURLとAPIキーを記入**する:

```bash
DIFY_BASE_URL=<Dify の API ベースURL>
DIFY_APP_KEY=<Dify のワークフローAPIキー>
```

## 使い方

Claude Code を起動し、自然文で依頼する:

```
Drive の <資料名> を、category「<カテゴリ名>」で Dify に入れて
```

Claude Code が SKILL.md の手順に沿って取得・整形・投入まで行う。

## 手動投入（スクリプト直接実行）

整形済み Markdown が手元にあるなら、スクリプトを直接叩いてもよい:

```bash
python3 ~/.claude/skills/dify-rag-inject/dify_inject.py \
    --category '<カテゴリ名>' \
    --doc-name '<資料名>' \
    --file './<資料名>_整形版.md'
```

`--dry-run` を付けると送信せず内容だけ確認できる。

## 注意

- `config`（APIキー入り）は **git にコミットしない**（`.gitignore` 済み）。
- 同じ category・doc_name で再投入すると上書き更新（UPSERT）になる。重複ドキュメントは作られない。

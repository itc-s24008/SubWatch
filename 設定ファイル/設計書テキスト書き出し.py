#!/usr/bin/env python3
"""設計書（Excel）を、AIが読みやすいテキストに書き出す。
使い方：リポジトリの直下で python3 設計書テキスト書き出し.py
設計書/*.xlsx を読み、設計書テキスト/ に「書類名.txt」を作る。設計書を直したら、もう一度実行してコミットする。
必要なもの：sudo apt install -y python3-openpyxl
"""
import glob, os
import openpyxl

os.makedirs('設計書テキスト', exist_ok=True)
for old in glob.glob(os.path.join('設計書テキスト', '*.txt')):
    os.remove(old)  # 名前を変えた設計書の古いテキストを残さない
files = sorted(glob.glob('設計書/*.xlsx'))
if not files:
    raise SystemExit('設計書/ に Excel がありません')
for path in files:
    wb = openpyxl.load_workbook(path)
    name = os.path.splitext(os.path.basename(path))[0]
    with open(os.path.join('設計書テキスト', name + '.txt'), 'w', encoding='utf-8') as out:
        for ws in wb.worksheets:
            out.write(f'\n##### シート：{ws.title}\n')
            if 'ガント' in ws.title:
                out.write('（ガントチャートは省略。日付は WBS のシートを見る）\n')
                continue
            for row in ws.iter_rows():
                cells = [(c.coordinate, c.value) for c in row if c.value is not None]
                if cells:
                    out.write(' | '.join(f'{a}={str(v)}' for a, v in cells) + '\n')
    print('書き出し：', name)

# アイコンの下書きを作る。3つのアプリ × 2つの型（手帳型・記号だけ）
COL = {'plan': '#1F4FA0', 'road': '#1F7470', 'fish': '#C2581B'}
RIBBON = '#F2B33D'

def plan(c, ink):  # 旅の計画: 点線のルートと、最後にピン
    return (f'<polyline points="168,356 228,286 296,318" fill="none" stroke="{ink}" stroke-width="18" stroke-linecap="round" stroke-dasharray="2 28"/>'
            f'<circle cx="168" cy="356" r="22" fill="{ink}"/><circle cx="228" cy="286" r="22" fill="{ink}"/>'
            f'<path d="M314 300 C284 262 266 238 266 214 a48 48 0 0 1 96 0 c0 24-18 48-48 86z" fill="{ink}"/>'
            f'<circle cx="314" cy="212" r="17" fill="{c}"/>')

def road(c, ink):  # 道の記録: 曲がった道と中央線
    d = 'M200 384 C200 322 312 326 312 262 C312 204 214 204 214 148'
    return (f'<path d="{d}" fill="none" stroke="{ink}" stroke-width="52" stroke-linecap="round"/>'
            f'<path d="{d}" fill="none" stroke="{c}" stroke-width="9" stroke-linecap="round" stroke-dasharray="20 22"/>')

def fish(c, ink):  # 釣り: 魚
    return (f'<path d="M150 268 C190 200 288 196 330 268 C288 340 190 336 150 268 Z" fill="{ink}"/>'
            f'<path d="M318 268 L374 222 L362 268 L374 314 Z" fill="{ink}"/>'
            f'<circle cx="196" cy="256" r="13" fill="{c}"/>')

SYM = {'plan': plan, 'road': road, 'fish': fish}

def notebook(key):  # 手帳型: 色の地に白い手帳、その中に記号。上に栞
    c = COL[key]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            f'<rect width="512" height="512" rx="112" fill="{c}"/>'
            f'<rect x="120" y="88" width="272" height="336" rx="34" fill="#fff"/>'
            f'<path d="M332 70 h40 v104 l-20 -18 l-20 18 z" fill="{RIBBON}"/>'
            f'<g>{SYM[key](c, c)}</g></svg>')

def symbol(key):  # 記号だけ: 色の地に白い記号を大きく。右上に栞
    c = COL[key]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            f'<rect width="512" height="512" rx="112" fill="{c}"/>'
            f'<path d="M372 0 h48 v96 l-24 -20 l-24 20 z" fill="{RIBBON}"/>'
            f'<g transform="translate(256 266) scale(1.22) translate(-258 -266)">{SYM[key](c, "#fff")}</g></svg>')

for k in COL:
    open(f'{k}-notebook.svg', 'w').write(notebook(k))
    open(f'{k}-symbol.svg', 'w').write(symbol(k))

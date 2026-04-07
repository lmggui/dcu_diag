from pathlib import Path

p = Path('d:/code/dcu_diag/claude_dcu_diag.html')
text = p.read_text(encoding='utf-8')

si = text.find('<style>')
ei = text.find('</style>', si)
if si == -1 or ei == -1:
    raise RuntimeError('style block not found')
style = text[si+7:ei]

ssi = text.find('<script>', ei)
ee = text.find('</script>', ssi)
if ssi == -1 or ee == -1:
    raise RuntimeError('script block not found')
script = text[ssi+8:ee]

Path('d:/code/dcu_diag/styles.css').write_text(style, encoding='utf-8')
Path('d:/code/dcu_diag/app.js').write_text(script, encoding='utf-8')

new_text = (
    text[:si]
    + '<link rel="stylesheet" href="styles.css">'
    + text[ei+9:ssi]
    + '<script src="app.js"></script>'
    + text[ee+9:]
)

p.write_text(new_text, encoding='utf-8')
print('done')

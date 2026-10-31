# Rebuilds src/index.js from source/: python3 build.py
import json
d='source/'
html=open(d+'student.html').read().replace('/*DOC_CSS*/',open(d+'doc.css').read()).replace('/*DOC_JS*/',open(d+'doc.js').read())
open('src/index.js','w').write(open(d+'api.js').read().replace('__STUDENT_HTML__',json.dumps(html,ensure_ascii=False)))

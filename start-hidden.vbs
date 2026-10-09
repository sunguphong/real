' 매물 추적기 서버 + 외부 접속 터널을 콘솔 창 없이(숨김) 실행한다.
' 로그인 시 자동 실행되도록 시작프로그램 폴더에 등록해 사용한다.
'  - server.js : 로컬 웹서버(5173) + Basic Auth
'  - tunnel.js : localtunnel 고정 주소(https://dongtan-forenus.loca.lt) 공개
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "D:\ANTI\real"
node = """C:\Program Files\nodejs\node.exe"""
sh.Run node & " ""D:\ANTI\real\server.js""", 0, False
WScript.Sleep 3000  ' 서버가 5173에 먼저 뜨도록 잠깐 대기
sh.Run node & " ""D:\ANTI\real\tunnel.js""", 0, False

#!/usr/bin/env python3
"""`agy` falso para los tests de voz: imita lo justo de su TUI y de su dictado.

Pide confianza en la carpeta, dibuja la caja de entrada entre dos líneas horizontales y,
con F5, se conecta a ANTIGRAVITY_MIC y "transcribe" así: el texto es `heard N`, con N =
los bytes no nulos de audio recibidos. Ctrl+U vacía la caja; Esc descarta la grabación.
"""
import os, socket, sys, termios, threading, time, tty

RULE = "─" * 100
lock = threading.Lock()
st = {"text": "", "before": "", "recording": False, "t0": 0.0, "heard": 0, "sock": None}


def draw(lines):
    sys.stdout.write("\x1b[2J\x1b[H" + "\n".join(lines) + "\n")
    sys.stdout.flush()


def render():
    with lock:
        lines = ["  Fake Antigravity CLI", "  " + os.getcwd(), RULE, "> " + st["text"] if st["text"] else ">", RULE]
        if st["recording"]:
            lines.append(f"● Recording 00:{int(time.time() - st['t0']):02d}  enter or f5 to insert · esc to discard")
        lines.append("? for shortcuts" + " " * 40 + "Fake · high")
        draw(lines)


def mic_loop(sock):
    while True:
        try:
            data = sock.recv(4096)
        except OSError:
            return
        if not data:
            return
        with lock:
            if not st["recording"]:
                return
            st["heard"] += sum(1 for b in data if b)
            st["text"] = f"heard {st['heard']}"


def ticker():
    while st["recording"]:
        render()
        time.sleep(0.1)


def start():
    host, port = os.environ["ANTIGRAVITY_MIC"].rsplit(":", 1)
    sock = socket.create_connection((host, int(port)), timeout=5)
    with lock:
        st.update(recording=True, t0=time.time(), heard=0, sock=sock, before=st["text"])
    threading.Thread(target=mic_loop, args=(sock,), daemon=True).start()
    threading.Thread(target=ticker, daemon=True).start()


def stop(keep):
    with lock:
        st["recording"] = False
        if not keep:
            st["text"] = st["before"]
        sock, st["sock"] = st["sock"], None
    if sock:
        sock.close()
    render()


def main():
    fd = sys.stdin.fileno()
    tty.setraw(fd)
    if not os.path.exists(".trusted"):
        draw(["Accessing workspace:", os.getcwd(), "Do you trust the contents of this project?",
              "> Yes, I trust this folder", "  No, exit"])
        while os.read(fd, 16) != b"\r":
            pass
        open(".trusted", "w").close()
    render()
    while True:
        data = os.read(fd, 64)
        if not data:
            return
        if data == b"\x1b[15~":
            stop(True) if st["recording"] else start()
        elif data == b"\r" and st["recording"]:
            stop(True)
        elif data == b"\x1b" and st["recording"]:
            stop(False)
        elif data == b"\x15":
            with lock:
                st["text"] = ""
            render()


try:
    main()
finally:
    termios.tcflush(0, termios.TCIOFLUSH)

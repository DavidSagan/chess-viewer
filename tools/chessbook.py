#!/usr/bin/env python3
"""Builds a chess book from LaTeX with chess commands. It checks every move, draws the
diagrams, and links moves and diagrams to the Lichess analysis board.

Usage:
    pip install chess cairosvg
    python3 chessbook.py book.tex

Needs pdflatex and the Cairo library. With MacPorts, Cairo may only be found if you run:
    DYLD_FALLBACK_LIBRARY_PATH=/opt/local/lib python3 chessbook.py book.tex

Commands in book.tex:
    \\game{d4 d5 Nf3 ...}     The whole main line, in plain SAN. Comes before the other commands.
    \\mainline{6.g3 Be6}      The next main line moves, passed to your \\Move command.
    \\moves{8...h6}           Moves in the text. A numbered first move branches off the main
                             line at that point.
    \\moves[as=a]{...}        Also names this line, so that later moves can start from it.
    \\moves[from=a]{...}      Starts from the named line, at the first move's number.
    \\moves[plain]{...}      Checks and typesets the moves, with no Lichess links.
    \\board                   Diagram of the current main line position, passed to your
                             \\ChessDiagram command.
    \\board[after=14...Qxf6,width=4cm,bare]
                             Diagram after a main line move, at a given width. With bare, it
                             is not passed to \\ChessDiagram.
    \\figK \\figQ \\figR \\figB \\figN
                             Piece figurines for use in ordinary text, as in \\figN{}g5.
"""

import hashlib
import pathlib
import re
import subprocess
import sys

import cairosvg
import chess
import chess.svg

LICHESS = "https://lichess.org/analysis/pgn/"
TOKEN = re.compile(r"(?:(\d+)(\.{1,3}))?(O-O(?:-O)?|[KQRBN][a-h1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|[a-h][1-8](?:=[QRBN])?)"
                   r"([+#]?)([!?]*)")


class BookError(Exception):
    pass


def split_token(token):
    match = TOKEN.fullmatch(token)
    if match is None:
        raise BookError(f"Not a move: {token}")
    return match.groups()


def board_after(sans):
    board = chess.Board()
    for san in sans:
        board.push_san(san)
    return board


def display(token):
    """Return LaTeX for a move, with its piece letter as a figurine."""
    number, dots, san, check, marks = split_token(token)
    prefix = f"{number}{dots}" if number else ""
    if san.startswith("O"):
        text = san.replace("O", "0").replace("-", "--")
    elif san[0] in "KQRBN":
        text = f"\\fig{san[0]} {san[1:]}"
    else:
        text = san
    return prefix + text + check + marks


class Book:
    def __init__(self, source, outdir):
        self.source = source
        self.diagrams = outdir / "diagrams"
        self.diagrams.mkdir(parents=True, exist_ok=True)
        self.main = []
        self.pointer = 0
        self.named = {}
        self.count = {"moves": 0, "boards": 0}

    def fail(self, match, message):
        line = self.source.count("\n", 0, match.start()) + 1
        raise BookError(f"Line {line}: {match[0][:50]}: {message}")

    def link(self, sans):
        return LICHESS + "_".join(sans).replace("#", "").replace("+", "")

    def play(self, start, text, match, links=True):
        """Play moves after the line `start`. Returns LaTeX for them, and the new line."""
        line = list(start)
        out = []
        for token in text.split():
            number, dots, san, check, _ = split_token(token)
            if number:
                ply = 2 * (int(number) - 1) + (1 if dots == "..." else 0)
                if ply > len(line):
                    self.fail(match, f"{token} does not follow from the {len(line)} moves before it")
                line = line[:ply]
            board = board_after(line)
            try:
                move = board.parse_san(san + check)
            except ValueError:
                self.fail(match, f"{token} is not legal in {board.fen()}")
            played = board.san(move)
            if check and not played.endswith(check):
                self.fail(match, f"{token} is marked {check} but the move is {played}")
            if not check and played[-1] in "+#":
                self.fail(match, f"{token} should be written {played}")
            line.append(played)
            if links:
                out.append(f"\\href{{{self.link(line)}}}{{{display(token)}}}")
                self.count["moves"] += 1
            else:
                out.append(display(token))
        return " ".join(out), line

    def mainline(self, match):
        latex, line = self.play(self.main[:self.pointer], match["main"].strip(), match)
        if line != self.main[:len(line)]:
            self.fail(match, "this differs from \\game")
        self.pointer = len(line)
        return f"\\Move{{{latex}}}"

    def moves(self, match):
        options = dict(option.partition("=")[::2] for option in (match["options"] or "").split(",") if option)
        start = self.named[options["from"]] if "from" in options else self.main
        latex, line = self.play(start, match["moves"].strip(), match, links="plain" not in options)
        if "as" in options:
            self.named[options["as"]] = line
        return latex

    def board(self, match):
        options = {}
        for option in (match["board"] or "").split(","):
            if option:
                key, _, value = option.partition("=")
                options[key] = value
        if "after" in options:
            _, line = self.play(self.main, options["after"], match)
            self.count["moves"] -= 1
            if line != self.main[:len(line)]:
                self.fail(match, "this is not a main line move")
        else:
            line = self.main[:self.pointer]
        board = board_after(line)
        last = board.peek() if board.move_stack else None
        name = "board-" + hashlib.sha1(board.fen().encode()).hexdigest()[:12]
        cairosvg.svg2pdf(bytestring=chess.svg.board(board, size=360, lastmove=last).encode(),
                         write_to=str(self.diagrams / f"{name}.pdf"))
        self.count["boards"] += 1
        width = options.get("width", "\\boardwidth")
        image = f"\\href{{{self.link(line)}}}{{\\includegraphics[width={width}]{{diagrams/{name}}}}}"
        return image if "bare" in options else f"\\ChessDiagram{{{image}}}"

    def figurines(self):
        lines = []
        for letter in "KQRBN":
            piece = chess.Piece.from_symbol(letter)
            cairosvg.svg2pdf(bytestring=chess.svg.piece(piece, size=45).encode(),
                             write_to=str(self.diagrams / f"fig{letter}.pdf"))
            lines.append(f"\\newcommand{{\\fig{letter}}}{{\\raisebox{{-0.14em}}"
                         f"{{\\includegraphics[height=1em]{{diagrams/fig{letter}}}}}}}")
        return "\n".join(lines)

    def build(self):
        source = self.source
        game = re.search(r"\\game\{(.*?)\}", source, re.S)
        if game is None:
            raise BookError("Missing \\game{...}")
        board = chess.Board()
        for san in game[1].split():
            try:
                board.push_san(san)
            except ValueError:
                raise BookError(f"\\game: {san} is not legal in {board.fen()}")
            self.main.append(san)
        # Keep the line count, so that errors can name the line
        self.source = source = source.replace(game[0], "\n" * game[0].count("\n"))

        pattern = re.compile(r"\\mainline\{(?P<main>[^}]*)\}"
                             r"|\\moves(?:\[(?P<options>[^\]]*)\])?\{(?P<moves>[^}]*)\}"
                             r"|\\board(?:\[(?P<board>[^\]]*)\])?(?![A-Za-z])")

        def replace(match):
            if match["main"] is not None:
                return self.mainline(match)
            if match["moves"] is not None:
                return self.moves(match)
            return self.board(match)

        latex = pattern.sub(replace, source)
        return latex.replace("\\begin{document}", self.figurines() + "\n\\begin{document}", 1)


def main():
    path = pathlib.Path(sys.argv[1]).resolve()
    outdir = path.parent
    book = Book(path.read_text(), outdir)
    try:
        latex = book.build()
    except BookError as error:
        sys.exit(f"{path.name}: {error}")
    built = outdir / f"{path.stem}-built.tex"
    built.write_text(latex)
    for _ in range(2):      # A second pass settles the page references
        result = subprocess.run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error",
                                 f"-jobname={path.stem}", built.name], cwd=outdir, capture_output=True, text=True)
        if result.returncode:
            sys.exit(result.stdout[-1500:])
    print(f"{outdir / path.stem}.pdf: {book.count['moves']} move links, {book.count['boards']} diagrams")


if __name__ == "__main__":
    main()

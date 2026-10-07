#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
MAIN="main"
DOCKER_IMAGE="ghcr.io/xu-cheng/latex-action:latest"

cd "$DIR"

if [ "$1" == "clean" ]; then
    echo "==> Limpando arquivos temporários e auxiliares..."
    rm -f *.aux *.bbl *.blg *.brf *.fdb_latexmk *.fls *.idx *.ilg *.ind *.lof *.log *.lot *.nav *.out *.snm *.synctex.gz *.toc *.vrb *.dvi *.ps
    rm -f capitulos/*.aux pre-textual/*.aux pos-textual/*.aux
    echo "Limpeza concluída."
    exit 0
fi

if command -v latexmk >/dev/null 2>&1; then
    echo "==> Compilando via latexmk local..."
    latexmk -pdf -synctex=1 -interaction=nonstopmode -file-line-error ${MAIN}.tex
elif command -v pdflatex >/dev/null 2>&1; then
    echo "==> Compilando via pdflatex e bibtex local..."
    pdflatex -interaction=nonstopmode ${MAIN}.tex
    bibtex ${MAIN} || true
    pdflatex -interaction=nonstopmode ${MAIN}.tex
    pdflatex -interaction=nonstopmode ${MAIN}.tex
elif command -v docker >/dev/null 2>&1; then
    echo "==> LaTeX local não detectado no host."
    echo "==> Delegando compilação ao container Docker headless (${DOCKER_IMAGE})..."
    docker run --rm -v "$DIR":/work -w /work "$DOCKER_IMAGE" latexmk -pdf -synctex=1 -interaction=nonstopmode ${MAIN}.tex
else
    echo "ERRO: Nenhum compilador TeX (latexmk/pdflatex) ou Docker encontrado no PATH."
    exit 1
fi

echo "==> Compilação concluída com sucesso: $DIR/${MAIN}.pdf"

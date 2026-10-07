#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
MAIN="main"

cd "$DIR"

if [ "$1" == "clean" ]; then
    echo "==> Limpando arquivos temporários e auxiliares..."
    rm -f *.aux *.bbl *.blg *.brf *.fdb_latexmk *.fls *.idx *.ilg *.ind *.lof *.log *.lot *.nav *.out *.snm *.synctex.gz *.toc *.vrb *.dvi *.ps
    rm -f capitulos/*.aux pre-textual/*.aux pos-textual/*.aux
    echo "Limpeza concluída."
    exit 0
fi

# Detectar melhor imagem Docker disponível caso LaTeX local não exista
if docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "^(blang/latex:ubuntu|texlive/texlive:latest)" | head -n1 > /dev/null 2>&1; then
    DOCKER_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "^(blang/latex:ubuntu|texlive/texlive:latest)" | head -n1)
else
    DOCKER_IMAGE="blang/latex:ubuntu"
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
    echo "==> Compilando via container Docker headless (${DOCKER_IMAGE})..."
    docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$DIR":/work -w /work "$DOCKER_IMAGE" sh -c "
        pdflatex -interaction=nonstopmode ${MAIN}.tex &&
        bibtex ${MAIN} || true &&
        pdflatex -interaction=nonstopmode ${MAIN}.tex &&
        pdflatex -interaction=nonstopmode ${MAIN}.tex
    "
else
    echo "ERRO: Nenhum compilador TeX (latexmk/pdflatex) ou Docker encontrado no PATH."
    exit 1
fi

echo "==> Compilação concluída com sucesso: $DIR/${MAIN}.pdf"

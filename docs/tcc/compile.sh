#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
MAIN="main"

cd "$DIR"

if [ "$1" == "clean" ]; then
    echo "==> Removing temporary and auxiliary files..."
    rm -f *.aux *.bbl *.blg *.brf *.fdb_latexmk *.fls *.idx *.ilg *.ind *.lof *.log *.lot *.loq *.nav *.out *.snm *.synctex.gz *.toc *.vrb *.dvi *.ps
    rm -f capitulos/*.aux pre-textual/*.aux pos-textual/*.aux
    echo "Cleanup finished."
    exit 0
fi

# Pick the best available Docker image in case there is no local LaTeX
if docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "^(blang/latex:ubuntu|texlive/texlive:latest)" | head -n1 > /dev/null 2>&1; then
    DOCKER_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "^(blang/latex:ubuntu|texlive/texlive:latest)" | head -n1)
else
    DOCKER_IMAGE="blang/latex:ubuntu"
fi

if command -v latexmk >/dev/null 2>&1; then
    echo "==> Building with local latexmk..."
    latexmk -pdf -synctex=1 -interaction=nonstopmode -file-line-error ${MAIN}.tex
elif command -v pdflatex >/dev/null 2>&1; then
    echo "==> Building with local pdflatex and bibtex..."
    pdflatex -interaction=nonstopmode ${MAIN}.tex
    bibtex ${MAIN} || true
    pdflatex -interaction=nonstopmode ${MAIN}.tex
    pdflatex -interaction=nonstopmode ${MAIN}.tex
elif command -v docker >/dev/null 2>&1; then
    echo "==> No local LaTeX found on the host."
    echo "==> Building in a headless Docker container (${DOCKER_IMAGE})..."
    docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$DIR":/work -w /work "$DOCKER_IMAGE" sh -c "
        pdflatex -interaction=nonstopmode ${MAIN}.tex &&
        bibtex ${MAIN} || true &&
        pdflatex -interaction=nonstopmode ${MAIN}.tex &&
        pdflatex -interaction=nonstopmode ${MAIN}.tex
    "
else
    echo "ERROR: No TeX compiler (latexmk/pdflatex) or Docker found in PATH."
    exit 1
fi

echo "==> Build finished successfully: $DIR/${MAIN}.pdf"

# UTFPR requires the final version in PDF/A, named with up to four lowercase words
DELIVERY="simulacao-posix-sistemas-operacionais.pdf"
if command -v gs >/dev/null 2>&1; then
    gs -q -dPDFA=2 -dBATCH -dNOPAUSE -dPDFACompatibilityPolicy=1 \
        -sColorConversionStrategy=RGB -sDEVICE=pdfwrite \
        -sOutputFile="$DIR/$DELIVERY" "$DIR/${MAIN}.pdf"
    echo "==> PDF/A delivery file generated: $DIR/$DELIVERY"
else
    echo "WARNING: Ghostscript not found; PDF/A delivery file was not generated."
fi

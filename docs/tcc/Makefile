MAIN = main

HAS_LATEXMK := $(shell command -v latexmk 2>/dev/null)
HAS_PDFLATEX := $(shell command -v pdflatex 2>/dev/null)
HAS_DOCKER := $(shell command -v docker 2>/dev/null)

DOCKER_IMAGE ?= $(shell docker images --format "{{.Repository}}:{{.Tag}}" 2>/dev/null | grep -E "^(blang/latex:ubuntu|texlive/texlive:latest)" | head -n1)
ifeq ($(strip $(DOCKER_IMAGE)),)
  DOCKER_IMAGE = blang/latex:ubuntu
endif

.PHONY: all pdf docker-pdf watch clean

all: pdf

pdf:
ifdef HAS_LATEXMK
	@echo "==> Compilando via latexmk local..."
	latexmk -pdf -synctex=1 -interaction=nonstopmode -file-line-error $(MAIN).tex
else ifdef HAS_PDFLATEX
	@echo "==> Compilando via pdflatex e bibtex local..."
	pdflatex -interaction=nonstopmode $(MAIN).tex
	bibtex $(MAIN) || true
	pdflatex -interaction=nonstopmode $(MAIN).tex
	pdflatex -interaction=nonstopmode $(MAIN).tex
else ifdef HAS_DOCKER
	@echo "==> LaTeX local ausente. Delegando compilação ao container Docker ($(DOCKER_IMAGE))..."
	docker run --rm --user $(shell id -u):$(shell id -g) -e HOME=/tmp -v $(CURDIR):/work -w /work $(DOCKER_IMAGE) sh -c "\
		pdflatex -interaction=nonstopmode $(MAIN).tex && \
		bibtex $(MAIN) || true && \
		pdflatex -interaction=nonstopmode $(MAIN).tex && \
		pdflatex -interaction=nonstopmode $(MAIN).tex"
else
	@echo "ERRO: Nenhum compilador TeX (latexmk/pdflatex) ou Docker encontrado."
	@exit 1
endif

docker-pdf:
	@echo "==> Compilando explicitamente via container Docker ($(DOCKER_IMAGE))..."
	docker run --rm --user $(shell id -u):$(shell id -g) -e HOME=/tmp -v $(CURDIR):/work -w /work $(DOCKER_IMAGE) sh -c "\
		pdflatex -interaction=nonstopmode $(MAIN).tex && \
		bibtex $(MAIN) || true && \
		pdflatex -interaction=nonstopmode $(MAIN).tex && \
		pdflatex -interaction=nonstopmode $(MAIN).tex"

clean:
	@echo "==> Limpando arquivos temporários e auxiliares..."
	@rm -f *.aux *.bbl *.blg *.brf *.fdb_latexmk *.fls *.idx *.ilg *.ind *.lof *.log *.lot *.nav *.out *.snm *.synctex.gz *.toc *.vrb *.dvi *.ps
	@rm -f capitulos/*.aux pre-textual/*.aux pos-textual/*.aux
	@echo "Limpeza concluída."

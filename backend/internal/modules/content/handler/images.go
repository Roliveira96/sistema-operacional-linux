package handler

import (
	"context"
	"errors"
	"io"
	"math"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// ImageUploading is the use-case port of the images of the content (SPEC-025).
type ImageUploading interface {
	Upload(ctx context.Context, raw []byte) (service.UploadedImage, error)
}

// ImageHandler serves the upload of images.
type ImageHandler struct {
	images  ImageUploading
	auth    authn.Validator
	limiter Limiter
}

// NewImages creates the handler.
func NewImages(images ImageUploading, auth authn.Validator, limiter Limiter) *ImageHandler {
	return &ImageHandler{images: images, auth: auth, limiter: limiter}
}

// Register mounts the route under /api/v1/teacher.
func (h *ImageHandler) Register(r gin.IRouter) {
	teacher := r.Group("/teacher", authn.Required(h.auth), authn.PasswordChanged(),
		authn.Roles(authn.RoleTeacher, authn.RoleAdmin))
	teacher.POST("/content/images", h.upload)
}

type imageResponse struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Bytes  int    `json:"bytes"`
}

// multipartSlack is what the body may carry beyond the file: the boundaries and the headers of the form.
const multipartSlack = 64 << 10

func (h *ImageHandler) upload(c *gin.Context) {
	who, ok := actor(c)
	if !ok {
		authFail(c, problem.Unauthorized("not-authenticated", "Authentication is required."))
		return
	}
	if allowed, retry := h.limiter.Allow(who.UserID.String()); !allowed {
		authFail(c, problem.TooManyRequests("Too many uploads. Try again later.", int(math.Ceil(retry.Seconds()))))
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, domain.MaxImageBytes+multipartSlack)

	header, err := c.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			authFail(c, problem.PayloadTooLarge("A imagem excede o limite de 10 MB."))
			return
		}
		authFail(c, problem.Validation("Envie o arquivo da imagem no campo file.", problem.InvalidParam{Name: "file", Reason: "required"}))
		return
	}
	if header.Size > domain.MaxImageBytes {
		authFail(c, problem.PayloadTooLarge("A imagem excede o limite de 10 MB."))
		return
	}
	file, err := header.Open()
	if err != nil {
		authFail(c, problem.Validation("Não foi possível ler o arquivo.", problem.InvalidParam{Name: "file", Reason: "unreadable"}))
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, domain.MaxImageBytes+1))
	if err != nil {
		authFail(c, problem.Validation("Não foi possível ler o arquivo.", problem.InvalidParam{Name: "file", Reason: "unreadable"}))
		return
	}

	out, err := h.images.Upload(c.Request.Context(), raw)
	if err != nil {
		authFail(c, imageProblem(err))
		return
	}
	c.JSON(http.StatusCreated, imageResponse{URL: out.URL, Width: out.Width, Height: out.Height, Bytes: out.Bytes})
}

func imageProblem(err error) error {
	switch {
	case errors.Is(err, domain.ErrImageTooLarge):
		return problem.PayloadTooLarge("A imagem excede o limite de 10 MB.")
	case errors.Is(err, domain.ErrImageNotImage):
		return problem.Validation("O arquivo não é uma imagem aceita (JPEG, PNG, WebP, GIF ou AVIF).", problem.InvalidParam{Name: "file", Reason: "not an accepted image"})
	case errors.Is(err, domain.ErrImageDimension):
		return problem.Validation("A imagem tem pixels demais. Reduza-a antes de enviar.", problem.InvalidParam{Name: "file", Reason: "too many pixels"})
	case errors.Is(err, service.ErrImageStorage):
		return problem.ServiceUnavailable("O armazenamento de imagens está indisponível. Tente de novo.")
	}
	return err
}

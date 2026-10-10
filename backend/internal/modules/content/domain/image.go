package domain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	_ "image/gif"  // GIF input
	_ "image/jpeg" // JPEG input
	_ "image/png"  // PNG input

	"github.com/disintegration/imaging"
	"github.com/gen2brain/avif"
	_ "golang.org/x/image/webp" // WebP input
)

// Limits of the images of the content (SPEC-025).
const (
	// MaxImageBytes is the largest file the teacher can send (RN-02).
	MaxImageBytes = 10 << 20
	// MaxImageWidth is the widest an image is kept: wider ones are reduced to it, narrower ones stay as they are (RN-04).
	MaxImageWidth = 1220
	// MaxImageSide and MaxImagePixels bound what is decoded, so a small file that expands to a huge picture cannot exhaust memory.
	MaxImageSide   = 12000
	MaxImagePixels = 64_000_000
	// ImagePrefix is where the images of the content live in the bucket (P-01).
	ImagePrefix = "conteudo/"
)

// Errors of the image processing; each is the teacher's mistake, not the server's.
var (
	ErrImageTooLarge  = errors.New("image is larger than 10 MB")
	ErrImageNotImage  = errors.New("file is not an accepted image (JPEG, PNG, WebP, GIF or AVIF)")
	ErrImageDimension = errors.New("image has too many pixels")
)

// Image is an image ready to be stored.
type Image struct {
	Data        []byte
	ContentType string
	Width       int
	Height      int
	// Key is the name of the object in the bucket, from the content of Data (RN-06).
	Key string
}

// avifQuality is a good balance of weight and sharpness for pictures and screenshots.
const (
	avifQuality = 60
	avifSpeed   = 8
)

// ProcessImage validates what the teacher sent by decoding it (RN-03) and returns what goes to the bucket: an AVIF with no metadata, at most
// 1220 px wide and never enlarged (RN-04, RN-05), or the GIF exactly as it came (RN-04a). It names the object by the content (RN-06).
func ProcessImage(raw []byte) (Image, error) {
	if len(raw) > MaxImageBytes {
		return Image{}, ErrImageTooLarge
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "jpeg" && format != "png" && format != "gif" && format != "webp" && format != "avif") {
		return Image{}, ErrImageNotImage
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > MaxImageSide || cfg.Height > MaxImageSide || cfg.Width*cfg.Height > MaxImagePixels {
		return Image{}, ErrImageDimension
	}

	// The GIF keeps its format, its frames and its size.
	if format == "gif" {
		return named(Image{Data: raw, ContentType: "image/gif", Width: cfg.Width, Height: cfg.Height}, "gif"), nil
	}

	// Decoding applies the orientation of the camera (EXIF), so the picture is stored upright; the metadata does not survive the encoding.
	img, err := imaging.Decode(bytes.NewReader(raw), imaging.AutoOrientation(true))
	if err != nil {
		return Image{}, ErrImageNotImage
	}
	if img.Bounds().Dx() > MaxImageWidth {
		img = imaging.Resize(img, MaxImageWidth, 0, imaging.Lanczos)
	}
	var out bytes.Buffer
	if err := avif.Encode(&out, img, avif.Options{Quality: avifQuality, QualityAlpha: avifQuality, Speed: avifSpeed}); err != nil {
		return Image{}, err
	}
	b := img.Bounds()
	return named(Image{Data: out.Bytes(), ContentType: "image/avif", Width: b.Dx(), Height: b.Dy()}, "avif"), nil
}

func named(img Image, ext string) Image {
	sum := sha256.Sum256(img.Data)
	img.Key = ImagePrefix + hex.EncodeToString(sum[:]) + "." + ext
	return img
}

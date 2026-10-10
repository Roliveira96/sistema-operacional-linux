package domain

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"

	"github.com/gen2brain/avif"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func pngOf(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 255 / w), G: uint8(y * 255 / h), B: 120, A: 255})
		}
	}
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, img))
	return buf.Bytes()
}

func decodeAVIF(t *testing.T, data []byte) image.Image {
	t.Helper()
	img, err := avif.Decode(bytes.NewReader(data))
	require.NoError(t, err)
	return img
}

// jpegWithOrientation makes a JPEG of w x h whose EXIF says it has to be turned (6 is a quarter turn, as a phone held upright writes it).
func jpegWithOrientation(t *testing.T, w, h int, orientation byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h)), nil))
	exif := []byte{
		'E', 'x', 'i', 'f', 0, 0,
		'M', 'M', 0, 42, 0, 0, 0, 8, // big endian TIFF header, first IFD at 8
		0, 1, // one entry
		0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, // Orientation, SHORT, count 1
		0, 0, 0, 0, // no next IFD
	}
	seg := append([]byte{0xFF, 0xE1, byte((len(exif) + 2) >> 8), byte((len(exif) + 2) & 0xFF)}, exif...)
	raw := buf.Bytes()
	return append(append(append([]byte{}, raw[:2]...), seg...), raw[2:]...)
}

// Covers SPEC-025 CA-01, CA-02: a wide image is reduced to 1220 px keeping the proportion, and what is stored is an AVIF.
func TestProcessImage_ReducesWideImagesToAVIF(t *testing.T) {
	out, err := ProcessImage(pngOf(t, 2440, 1220))
	require.NoError(t, err)
	assert.Equal(t, "image/avif", out.ContentType)
	assert.Equal(t, MaxImageWidth, out.Width)
	assert.Equal(t, 610, out.Height)
	assert.True(t, strings.HasPrefix(out.Key, ImagePrefix) && strings.HasSuffix(out.Key, ".avif"), out.Key)
	b := decodeAVIF(t, out.Data).Bounds()
	assert.Equal(t, MaxImageWidth, b.Dx())
	assert.Equal(t, 610, b.Dy())
}

// Covers SPEC-025 CA-03: an image of 1220 px or less keeps its size, and is never enlarged.
func TestProcessImage_KeepsSmallImages(t *testing.T) {
	for _, w := range []int{300, MaxImageWidth} {
		out, err := ProcessImage(pngOf(t, w, 100))
		require.NoError(t, err)
		assert.Equal(t, w, out.Width, "width %d", w)
		assert.Equal(t, 100, out.Height)
		b := decodeAVIF(t, out.Data).Bounds()
		assert.Equal(t, w, b.Dx())
	}
}

// Covers SPEC-025 RN-02: JPEG, WebP and AVIF come in as well, and all of them leave as AVIF.
func TestProcessImage_AcceptsTheOtherFormats(t *testing.T) {
	var jpg bytes.Buffer
	require.NoError(t, jpeg.Encode(&jpg, image.NewRGBA(image.Rect(0, 0, 64, 32)), nil))
	webp, err := base64.StdEncoding.DecodeString("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
	require.NoError(t, err)
	first, err := ProcessImage(pngOf(t, 80, 40))
	require.NoError(t, err)

	for name, raw := range map[string][]byte{"jpeg": jpg.Bytes(), "webp": webp, "avif": first.Data} {
		out, err := ProcessImage(raw)
		require.NoError(t, err, name)
		assert.Equal(t, "image/avif", out.ContentType, name)
		assert.Positive(t, out.Width, name)
	}
}

// Covers SPEC-025 CA-06: the picture is stored upright and carries no metadata.
func TestProcessImage_AppliesOrientationAndDropsMetadata(t *testing.T) {
	raw := jpegWithOrientation(t, 80, 40, 6)
	require.True(t, bytes.Contains(raw, []byte("Exif")))
	out, err := ProcessImage(raw)
	require.NoError(t, err)
	// A quarter turn swaps the sides.
	assert.Equal(t, 40, out.Width)
	assert.Equal(t, 80, out.Height)
	assert.False(t, bytes.Contains(out.Data, []byte("Exif")))
}

// Covers SPEC-025 CA-10, RN-04a: a GIF stays exactly as it came, even animated and even wide.
func TestProcessImage_KeepsTheGIFAsItCame(t *testing.T) {
	pal := color.Palette{color.Black, color.White}
	frame := func() *image.Paletted { return image.NewPaletted(image.Rect(0, 0, 2000, 10), pal) }
	var buf bytes.Buffer
	require.NoError(t, gif.EncodeAll(&buf, &gif.GIF{Image: []*image.Paletted{frame(), frame()}, Delay: []int{5, 5}}))

	out, err := ProcessImage(buf.Bytes())
	require.NoError(t, err)
	assert.Equal(t, buf.Bytes(), out.Data)
	assert.Equal(t, "image/gif", out.ContentType)
	assert.Equal(t, 2000, out.Width)
	assert.Equal(t, 10, out.Height)
	assert.True(t, strings.HasSuffix(out.Key, ".gif"), out.Key)
	decoded, err := gif.DecodeAll(bytes.NewReader(out.Data))
	require.NoError(t, err)
	assert.Len(t, decoded.Image, 2, "the animation is kept")
}

// Covers SPEC-025 CA-05, RN-06: the name comes from the content, so the same image is the same object and another one is not.
func TestProcessImage_NamesByContent(t *testing.T) {
	raw := pngOf(t, 50, 50)
	a, err := ProcessImage(raw)
	require.NoError(t, err)
	b, err := ProcessImage(raw)
	require.NoError(t, err)
	other, err := ProcessImage(pngOf(t, 51, 50))
	require.NoError(t, err)
	assert.Equal(t, a.Key, b.Key)
	assert.NotEqual(t, a.Key, other.Key)
	assert.Len(t, strings.TrimSuffix(strings.TrimPrefix(a.Key, ImagePrefix), ".avif"), 64)
}

// Covers SPEC-025 CA-04, RN-03: what does not decode as an accepted image is refused, whatever it says it is.
func TestProcessImage_RefusesWhatIsNotAnAcceptedImage(t *testing.T) {
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>`)
	png := pngOf(t, 20, 20)
	cases := map[string][]byte{
		"text":      []byte("isto não é uma imagem"),
		"empty":     {},
		"svg":       svg,
		"truncated": png[:len(png)/2],
		"html":      []byte("<html><body>oi</body></html>"),
	}
	for name, raw := range cases {
		_, err := ProcessImage(raw)
		assert.ErrorIs(t, err, ErrImageNotImage, name)
	}
}

// Covers SPEC-025 CA-04: more than 10 MB is refused before anything is decoded.
func TestProcessImage_RefusesTooLargeFiles(t *testing.T) {
	_, err := ProcessImage(make([]byte, MaxImageBytes+1))
	assert.ErrorIs(t, err, ErrImageTooLarge)
}

// Covers SPEC-025 section 6: a small file that expands into a huge picture is refused by its declared size.
func TestProcessImage_RefusesTooManyPixels(t *testing.T) {
	var wide bytes.Buffer
	require.NoError(t, png.Encode(&wide, image.NewGray(image.Rect(0, 0, MaxImageSide+1, 1))))
	_, err := ProcessImage(wide.Bytes())
	assert.ErrorIs(t, err, ErrImageDimension)

	var many bytes.Buffer
	require.NoError(t, png.Encode(&many, image.NewGray(image.Rect(0, 0, 9000, 9000))))
	_, err = ProcessImage(many.Bytes())
	assert.ErrorIs(t, err, ErrImageDimension)
}

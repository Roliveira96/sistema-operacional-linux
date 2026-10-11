package service

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/storage"
)

type fakeImageStore struct {
	mu        sync.Mutex
	objects   map[string][]byte
	types     map[string]string
	puts      int
	existsErr error
	putErr    error
	gate      chan struct{}
}

func newImageStore() *fakeImageStore {
	return &fakeImageStore{objects: map[string][]byte{}, types: map[string]string{}}
}

func (f *fakeImageStore) Exists(_ context.Context, key string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.objects[key]
	return ok, f.existsErr
}

func (f *fakeImageStore) PutImmutable(_ context.Context, key string, data []byte, contentType string) error {
	if f.gate != nil {
		<-f.gate
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.putErr != nil {
		return f.putErr
	}
	f.puts++
	f.objects[key], f.types[key] = data, contentType
	return nil
}

func (f *fakeImageStore) URL(key string) string { return "http://bucket/" + key }

func smallPNG(t *testing.T, w int) []byte {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, 20))))
	return buf.Bytes()
}

// Covers SPEC-025 CA-01: the image goes to the bucket as an AVIF and the teacher gets its address and size.
func TestImages_UploadStoresTheConvertedImage(t *testing.T) {
	store := newImageStore()
	out, err := NewImages(store, zap.NewNop(), 2).Upload(context.Background(), smallPNG(t, 120))
	require.NoError(t, err)

	require.Len(t, store.objects, 1)
	for key, data := range store.objects {
		assert.True(t, strings.HasPrefix(key, domain.ImagePrefix) && strings.HasSuffix(key, ".avif"), key)
		assert.Equal(t, "image/avif", store.types[key])
		assert.Equal(t, "http://bucket/"+key, out.URL)
		assert.Equal(t, len(data), out.Bytes)
	}
	assert.Equal(t, 120, out.Width)
	assert.Equal(t, 20, out.Height)
}

// Covers SPEC-025 CA-05: an image already in the bucket is not sent again, and the address is the same.
func TestImages_UploadReusesWhatIsAlreadyThere(t *testing.T) {
	store := newImageStore()
	svc := NewImages(store, zap.NewNop(), 1)
	first, err := svc.Upload(context.Background(), smallPNG(t, 64))
	require.NoError(t, err)
	second, err := svc.Upload(context.Background(), smallPNG(t, 64))
	require.NoError(t, err)
	assert.Equal(t, first.URL, second.URL)
	assert.Equal(t, 1, store.puts)
}

// Covers SPEC-025 CA-04: what is refused never reaches the bucket.
func TestImages_UploadRefusesBeforeTouchingTheBucket(t *testing.T) {
	store := newImageStore()
	_, err := NewImages(store, zap.NewNop(), 1).Upload(context.Background(), []byte("não é imagem"))
	assert.ErrorIs(t, err, domain.ErrImageNotImage)
	assert.Zero(t, store.puts)
}

// The bucket being down is told apart from the teacher's mistake.
func TestImages_UploadReportsAnUnavailableBucket(t *testing.T) {
	svc := func(s *fakeImageStore) *Images { return NewImages(s, zap.NewNop(), 1) }
	check := newImageStore()
	check.existsErr = errors.New("boom")
	_, err := svc(check).Upload(context.Background(), smallPNG(t, 40))
	assert.ErrorIs(t, err, ErrImageStorage)

	put := newImageStore()
	put.putErr = errors.New("boom")
	_, err = svc(put).Upload(context.Background(), smallPNG(t, 40))
	assert.ErrorIs(t, err, ErrImageStorage)
}

// A GIF is stored as it came (SPEC-025 CA-10), with its own type.
func TestImages_UploadKeepsTheGIF(t *testing.T) {
	gif := []byte("GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;")
	store := newImageStore()
	out, err := NewImages(store, zap.NewNop(), 1).Upload(context.Background(), gif)
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(out.URL, ".gif"), out.URL)
	for key, data := range store.objects {
		assert.Equal(t, gif, data)
		assert.Equal(t, "image/gif", store.types[key])
	}
}

// Conversions are bounded: with every slot taken, a waiting upload gives up when its request is cancelled instead of piling up.
func TestImages_UploadWaitsForASlotAndGivesUpWhenCancelled(t *testing.T) {
	store := newImageStore()
	store.gate = make(chan struct{})
	svc := NewImages(store, zap.NewNop(), 1)
	done := make(chan error, 1)
	go func() {
		_, err := svc.Upload(context.Background(), smallPNG(t, 30))
		done <- err
	}()
	// The first upload holds the only slot, stuck on the bucket.
	require.Eventually(t, func() bool { return len(svc.slots) == 1 }, 2*time.Second, 5*time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := svc.Upload(ctx, smallPNG(t, 30))
	assert.ErrorIs(t, err, context.Canceled)

	close(store.gate)
	require.NoError(t, <-done)
}

func TestNewImagesNeedsAtLeastOneSlot(t *testing.T) {
	assert.Equal(t, 1, cap(NewImages(newImageStore(), zap.NewNop(), 0).slots))
}

// Against the MinIO of the environment (SPEC-025 section 8, integration): a real image goes in as AVIF, comes back through its public
// address and a second upload reuses it. It runs only when MINIO_ENDPOINT and its keys are set.
func TestImagesLiveWithMinIO(t *testing.T) {
	if os.Getenv("MINIO_ENDPOINT") == "" || os.Getenv("MINIO_ACCESS_KEY") == "" {
		t.Skip("MINIO_ENDPOINT is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	store, err := storage.New(config.StorageConfig{Endpoint: os.Getenv("MINIO_ENDPOINT"), AccessKey: os.Getenv("MINIO_ACCESS_KEY"), SecretKey: os.Getenv("MINIO_SECRET_KEY"), Bucket: os.Getenv("MINIO_BUCKET"), UseSSL: os.Getenv("MINIO_USE_SSL") == "true"})
	require.NoError(t, err)
	if err := store.EnsureBucket(ctx); err != nil {
		t.Skipf("MinIO is not reachable: %v", err)
	}
	require.NoError(t, store.AllowPublicRead(ctx, domain.ImagePrefix))

	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2000, 400))))
	svc := NewImages(store, zap.NewNop(), 1)
	first, err := svc.Upload(ctx, buf.Bytes())
	require.NoError(t, err)
	assert.Equal(t, 1220, first.Width)
	assert.Equal(t, 244, first.Height)

	res, err := http.Get(first.URL)
	require.NoError(t, err)
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	assert.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, "image/avif", res.Header.Get("Content-Type"))
	assert.Contains(t, res.Header.Get("Cache-Control"), "immutable")
	assert.Equal(t, first.Bytes, len(body))

	second, err := svc.Upload(ctx, buf.Bytes())
	require.NoError(t, err)
	assert.Equal(t, first.URL, second.URL)
}

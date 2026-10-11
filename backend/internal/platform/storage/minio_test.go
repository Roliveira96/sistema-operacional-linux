package storage

import (
	"context"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
)

func TestAllowPublicReadNeedsAPrefix(t *testing.T) {
	s, err := New(config.StorageConfig{Endpoint: "localhost:9000", AccessKey: "a", SecretKey: "b", Bucket: "x"})
	require.NoError(t, err)
	assert.Error(t, s.AllowPublicRead(context.Background(), ""))
}

func TestURLIsEmptyWithoutAKeyAndPublicWithOne(t *testing.T) {
	s, err := New(config.StorageConfig{Endpoint: "minio:9000", AccessKey: "a", SecretKey: "b", Bucket: "lab"})
	require.NoError(t, err)
	assert.Equal(t, "", s.URL(""))
	assert.Equal(t, "http://minio:9000/lab/conteudo/a.avif", s.URL("conteudo/a.avif"))
}

// Against the MinIO of the environment (SPEC-025 section 8, integration): an image is stored once, cached for good and readable by anyone
// under its prefix, while the rest of the bucket is not. It runs only when MINIO_ENDPOINT and its keys are set.
func TestMinIOImagesLive(t *testing.T) {
	endpoint := os.Getenv("MINIO_ENDPOINT")
	if endpoint == "" || os.Getenv("MINIO_ACCESS_KEY") == "" {
		t.Skip("MINIO_ENDPOINT is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	s, err := New(config.StorageConfig{Endpoint: endpoint, AccessKey: os.Getenv("MINIO_ACCESS_KEY"), SecretKey: os.Getenv("MINIO_SECRET_KEY"), Bucket: os.Getenv("MINIO_BUCKET"), UseSSL: os.Getenv("MINIO_USE_SSL") == "true"})
	require.NoError(t, err)
	if err := s.EnsureBucket(ctx); err != nil {
		t.Skipf("MinIO is not reachable: %v", err)
	}
	require.NoError(t, s.AllowPublicRead(ctx, "conteudo/"))

	key := "conteudo/teste-integracao.avif"
	require.NoError(t, s.PutImmutable(ctx, key, []byte("conteudo"), "image/avif"))
	exists, err := s.Exists(ctx, key)
	require.NoError(t, err)
	assert.True(t, exists)
	exists, err = s.Exists(ctx, "conteudo/nao-existe.avif")
	require.NoError(t, err)
	assert.False(t, exists)

	// Anyone reads it, and the browser may keep it for good.
	res, err := http.Get(s.URL(key))
	require.NoError(t, err)
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	assert.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, "conteudo", string(body))
	assert.Contains(t, res.Header.Get("Cache-Control"), "immutable")
	assert.Equal(t, "image/avif", res.Header.Get("Content-Type"))

	// What is outside the prefix stays private.
	require.NoError(t, s.PutObject(ctx, "privado/teste-integracao.txt", bytesReader("x"), 1, "text/plain"))
	other, err := http.Get(s.URL("privado/teste-integracao.txt"))
	require.NoError(t, err)
	defer other.Body.Close()
	assert.Equal(t, http.StatusForbidden, other.StatusCode)
}

func bytesReader(s string) io.Reader { return strings.NewReader(s) }

// Covers SPEC-025 RN-07: the statement is added to the policy the bucket has, never replacing what was granted, and running it again does
// not repeat it.
func TestWithPublicReadKeepsWhatWasGranted(t *testing.T) {
	existing := `{"Version":"2012-10-17","Statement":[{"Sid":"Avatars","Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::lab/avatars/*"]}]}`
	got, err := withPublicRead(existing, "lab", "conteudo/")
	require.NoError(t, err)
	assert.Contains(t, got, "arn:aws:s3:::lab/avatars/*")
	assert.Contains(t, got, "arn:aws:s3:::lab/conteudo/*")

	again, err := withPublicRead(got, "lab", "conteudo/")
	require.NoError(t, err)
	assert.Equal(t, 1, strings.Count(again, "lab/conteudo/*"))
	assert.Equal(t, 1, strings.Count(again, "lab/avatars/*"))

	// A bucket with no policy yet starts one; a broken one is reported, not overwritten.
	empty, err := withPublicRead("", "lab", "conteudo/")
	require.NoError(t, err)
	assert.Contains(t, empty, "lab/conteudo/*")
	_, err = withPublicRead("{not json", "lab", "conteudo/")
	assert.Error(t, err)
}

package server

import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"go.uber.org/zap"
)

// Covers SPEC-004 CA-15: an in-flight request completes after shutdown starts.
func TestGracefulShutdownWaitsForInFlightRequest(t *testing.T) {
	started := make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		time.Sleep(300 * time.Millisecond)
		_, _ = io.WriteString(w, "done")
	})

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := New(ln.Addr().String(), handler, zap.NewNop())
	ctx, cancel := context.WithCancel(context.Background())

	result := make(chan error, 1)
	go func() {
		_, stop, err := srv.Serve(ctx, ln, 5*time.Second)
		if stop != nil {
			stop()
		}
		result <- err
	}()

	body := make(chan string, 1)
	go func() {
		resp, err := http.Get("http://" + ln.Addr().String())
		if err != nil {
			body <- "error: " + err.Error()
			return
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		body <- string(b)
	}()

	<-started
	cancel()

	if got := <-body; got != "done" {
		t.Errorf("in-flight request got %q", got)
	}
	if err := <-result; err != nil {
		t.Errorf("serve returned %v", err)
	}
}

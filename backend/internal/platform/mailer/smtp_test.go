package mailer

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
)

// Covers SPEC-004 CA-14 against a real SMTP server (Mailpit). Opt-in: set
// SMTP_TEST_HOST and SMTP_TEST_PORT to run it.
func TestSMTPSenderDeliversToRealServer(t *testing.T) {
	host := os.Getenv("SMTP_TEST_HOST")
	port, _ := strconv.Atoi(os.Getenv("SMTP_TEST_PORT"))
	if host == "" || port == 0 {
		t.Skip("SMTP_TEST_HOST and SMTP_TEST_PORT not set")
	}
	sender := NewSMTPSender(config.MailConfig{Host: host, Port: port, From: "no-reply@linux-lab.local"})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := sender.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	err := sender.Send(ctx, Message{
		To:       []string{"student@example.com"},
		Subject:  "SPEC-004 CA-14 delivery check",
		TextBody: "Plain text body",
		HTMLBody: "<p>HTML body</p>",
	})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
}

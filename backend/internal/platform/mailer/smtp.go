package mailer

import (
	"context"
	"fmt"
	"net"
	"strconv"

	mail "github.com/wneessen/go-mail"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
)

// SMTPSender delivers messages through an SMTP server (Mailpit in development).
type SMTPSender struct {
	cfg config.MailConfig
}

// NewSMTPSender creates a sender for the configured server.
func NewSMTPSender(cfg config.MailConfig) *SMTPSender {
	return &SMTPSender{cfg: cfg}
}

// Send opens a connection, delivers msg and closes the connection.
func (s *SMTPSender) Send(ctx context.Context, msg Message) error {
	m := mail.NewMsg()
	if err := m.From(s.cfg.From); err != nil {
		return fmt.Errorf("set sender: %w", err)
	}
	if err := m.To(msg.To...); err != nil {
		return fmt.Errorf("set recipients: %w", err)
	}
	m.Subject(msg.Subject)
	m.SetBodyString(mail.TypeTextPlain, msg.TextBody)
	if msg.HTMLBody != "" {
		m.AddAlternativeString(mail.TypeTextHTML, msg.HTMLBody)
	}

	opts := []mail.Option{
		mail.WithPort(s.cfg.Port),
		mail.WithTLSPortPolicy(mail.TLSOpportunistic),
	}
	if s.cfg.Username != "" {
		opts = append(opts,
			mail.WithSMTPAuth(mail.SMTPAuthPlain),
			mail.WithUsername(s.cfg.Username),
			mail.WithPassword(s.cfg.Password))
	}
	client, err := mail.NewClient(s.cfg.Host, opts...)
	if err != nil {
		return fmt.Errorf("create smtp client: %w", err)
	}
	if err := client.DialAndSendWithContext(ctx, m); err != nil {
		return fmt.Errorf("send mail: %w", err)
	}
	return nil
}

// Ping checks that the SMTP server accepts TCP connections.
func (s *SMTPSender) Ping(ctx context.Context) error {
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(s.cfg.Host, strconv.Itoa(s.cfg.Port)))
	if err != nil {
		return err
	}
	return conn.Close()
}

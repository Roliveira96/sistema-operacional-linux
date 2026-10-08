package service

import (
	"net/url"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/mailer"
)

// The e-mail texts below are user-facing content addressed to Portuguese
// speakers, so they are written in Portuguese (exception to the English-only
// code rule, like the frontend messages file).

func resetPasswordEmail(to, publicURL, token string) mailer.Message {
	link := publicURL + "/reset-password?token=" + url.QueryEscape(token)
	return mailer.Message{
		To:      []string{to},
		Subject: "Redefinição de senha — Linux na Prática",
		TextBody: "Olá,\n\n" +
			"Recebemos um pedido para redefinir a senha da sua conta na plataforma Linux na Prática.\n\n" +
			"Para criar uma nova senha, acesse o link abaixo. Ele vale por 1 hora e só pode ser usado uma vez:\n\n" +
			link + "\n\n" +
			"Se você não fez esse pedido, ignore este e-mail: sua senha continua a mesma.\n",
		HTMLBody: "<p>Olá,</p>" +
			"<p>Recebemos um pedido para redefinir a senha da sua conta na plataforma Linux na Prática.</p>" +
			"<p>Para criar uma nova senha, acesse o link abaixo. Ele vale por 1 hora e só pode ser usado uma vez:</p>" +
			`<p><a href="` + link + `">Redefinir minha senha</a></p>` +
			"<p>Se você não fez esse pedido, ignore este e-mail: sua senha continua a mesma.</p>",
	}
}

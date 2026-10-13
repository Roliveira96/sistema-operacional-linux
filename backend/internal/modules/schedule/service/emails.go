package service

import (
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

// The e-mail texts below are user-facing content addressed to Portuguese speakers, so they are written in Portuguese
// (exception to the English-only code rule, like the frontend messages file and the e-mails of the auth module).

var weekdayNames = [...]string{"Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"}

// emailContent is an e-mail without its recipient.
type emailContent struct {
	subject string
	lines   []string // plain text paragraphs; the HTML body escapes them
	link    string
}

func (c emailContent) to(r Recipient, kind, dedupe string, now time.Time) OutboxItem {
	greeting := "Olá,"
	if r.Name != "" {
		greeting = "Olá, " + r.Name + ","
	}
	var text, body strings.Builder
	text.WriteString(greeting + "\n\n")
	body.WriteString("<p>" + html.EscapeString(greeting) + "</p>")
	for _, line := range c.lines {
		text.WriteString(line + "\n")
		body.WriteString("<p>" + strings.ReplaceAll(html.EscapeString(line), "\n", "<br>") + "</p>")
	}
	if c.link != "" {
		text.WriteString("\n" + c.link + "\n")
		body.WriteString(`<p><a href="` + html.EscapeString(c.link) + `">Abrir a agenda da turma</a></p>`)
	}
	text.WriteString("\nLinux na Prática\n")
	return OutboxItem{
		RecipientUserID: r.UserID, To: r.Email, Kind: kind, Subject: c.subject,
		TextBody: text.String(), HTMLBody: body.String(), DedupeKey: dedupe, SendAfter: now,
	}
}

func formatDay(d time.Time) string { return domain.Day(d).Format("02/01/2006") }

func classLink(publicURL string, class ClassInfo) string {
	if publicURL == "" {
		return ""
	}
	return publicURL + "/app/classes/" + class.ID.String() + "?tab=schedule"
}

// place describes where a session or meeting happens.
func place(mode domain.Mode, room, onlineURL *string) string {
	if mode == domain.ModeOnline {
		if onlineURL != nil {
			return "online: " + *onlineURL
		}
		return "online"
	}
	if room != nil && *room != "" {
		return "presencial, sala " + *room
	}
	return "presencial"
}

func describeSession(session domain.ClassSession) string {
	return fmt.Sprintf("%s, %s às %s (%s)", formatDay(session.Date), session.StartTime, session.EndTime,
		place(session.Mode, session.Room, session.OnlineURL))
}

func sessionChangedEmail(class ClassInfo, session domain.ClassSession, publicURL string) emailContent {
	c := emailContent{link: classLink(publicURL, class)}
	if session.Status == domain.SessionCanceled {
		c.subject = fmt.Sprintf("Aula cancelada em %s — %s", formatDay(session.Date), class.Name)
		c.lines = []string{fmt.Sprintf("A aula de %s do dia %s, das %s às %s, foi cancelada.",
			class.Name, formatDay(session.Date), session.StartTime, session.EndTime)}
	} else {
		c.subject = fmt.Sprintf("Aula alterada em %s — %s", formatDay(session.Date), class.Name)
		c.lines = []string{"A aula de " + class.Name + " ficou assim: " + describeSession(session) + "."}
	}
	if session.ChangeReason != nil {
		c.lines = append(c.lines, "Motivo: "+*session.ChangeReason)
	}
	return c
}

func extraSessionEmail(class ClassInfo, session domain.ClassSession, publicURL string) emailContent {
	return emailContent{
		subject: fmt.Sprintf("Aula extra em %s — %s", formatDay(session.Date), class.Name),
		lines:   []string{"Foi marcada uma aula extra de " + class.Name + ": " + describeSession(session) + "."},
		link:    classLink(publicURL, class),
	}
}

func eventEmail(class ClassInfo, event domain.ClassEvent, removed bool, publicURL string) emailContent {
	when := formatDay(event.Date)
	if !event.AllDay && event.StartTime != nil && event.EndTime != nil {
		when += fmt.Sprintf(", %s às %s", *event.StartTime, *event.EndTime)
	}
	c := emailContent{link: classLink(publicURL, class)}
	if removed {
		c.subject = fmt.Sprintf("Evento cancelado: %s — %s", event.Title, class.Name)
		c.lines = []string{fmt.Sprintf("O evento \"%s\" (%s) foi cancelado.", event.Title, when)}
		return c
	}
	c.subject = fmt.Sprintf("%s — %s", event.Title, class.Name)
	c.lines = []string{fmt.Sprintf("Evento da turma %s: %s, em %s.", class.Name, event.Title, when)}
	if event.Description != "" {
		c.lines = append(c.lines, event.Description)
	}
	if event.Location != nil {
		c.lines = append(c.lines, "Local: "+*event.Location)
	}
	if event.OnlineURL != nil {
		c.lines = append(c.lines, "Link: "+*event.OnlineURL)
	}
	return c
}

func periodEmail(class ClassInfo, period domain.SpecialPeriod, removed bool, publicURL string) emailContent {
	span := formatDay(period.FirstDay) + " a " + formatDay(period.LastDay)
	c := emailContent{link: classLink(publicURL, class)}
	switch {
	case removed:
		c.subject = fmt.Sprintf("Aulas normais de %s — %s", span, class.Name)
		c.lines = []string{fmt.Sprintf("O período \"%s\" (%s) foi desfeito: as aulas de %s voltam ao horário normal.", period.Label, span, class.Name)}
	case period.Action == domain.PeriodNoClasses:
		c.subject = fmt.Sprintf("Sem aulas de %s — %s", span, class.Name)
		c.lines = []string{fmt.Sprintf("%s: não haverá aulas de %s de %s.", period.Label, class.Name, span)}
	default:
		c.subject = fmt.Sprintf("Aulas online de %s — %s", span, class.Name)
		link := ""
		if period.OnlineURL != nil {
			link = " pelo link " + *period.OnlineURL
		}
		c.lines = []string{fmt.Sprintf("%s: as aulas de %s de %s serão online%s.", period.Label, class.Name, span, link)}
	}
	return c
}

func agendaEmail(class ClassInfo, meetings []domain.WeeklyMeeting, sessions []domain.ClassSession, publicURL string) emailContent {
	lines := []string{"Você está matriculado em " + class.Name + ". Estes são os encontros da turma:"}
	var regular []string
	for _, m := range meetings {
		regular = append(regular, fmt.Sprintf("%s, %s às %s (%s)", weekdayNames[m.Weekday], m.StartTime, m.EndTime, place(m.Mode, m.Room, m.OnlineURL)))
	}
	lines = append(lines, strings.Join(regular, "\n"))
	var next []string
	for _, session := range sessions {
		if session.Status == domain.SessionScheduled {
			next = append(next, describeSession(session))
		}
	}
	if len(next) > 0 {
		lines = append(lines, "Próximas aulas:", strings.Join(next, "\n"))
	}
	return emailContent{subject: "Agenda da turma " + class.Name, lines: lines, link: classLink(publicURL, class)}
}

func reminderEmail(class ClassInfo, session domain.ClassSession, publicURL string) emailContent {
	return emailContent{
		subject: fmt.Sprintf("Lembrete: aula de %s em %s às %s", class.Name, formatDay(session.Date), session.StartTime),
		lines:   []string{"Lembrete da aula de " + class.Name + ": " + describeSession(session) + "."},
		link:    classLink(publicURL, class),
	}
}

// classWeek is the sessions of one class in the week of a digest.
type classWeek struct {
	class    ClassInfo
	sessions []domain.ClassSession
}

func digestEmail(first, last time.Time, classes []classWeek, publicURL string) emailContent {
	lines := []string{"Suas aulas de " + formatDay(first) + " a " + formatDay(last) + ":"}
	for _, cw := range classes {
		var list []string
		for _, session := range cw.sessions {
			list = append(list, describeSession(session))
		}
		lines = append(lines, cw.class.Name+"\n"+strings.Join(list, "\n"))
	}
	link := ""
	if publicURL != "" {
		link = publicURL + "/app/calendar"
	}
	return emailContent{subject: "Suas aulas da semana de " + formatDay(first), lines: lines, link: link}
}

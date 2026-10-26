package service_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// Covers SPEC-086 CA-02, CA-03, CA-07 (RN-01, RN-04): the detail says who acted with whatever the name lookup gives (the e-mail of a user with no
// name), and nothing for a user that was removed (the screen then says "Usuário removido"); the events are all there, in order, in both cases.
func TestDetail_NamesWhoActedWithWhatTheLookupGives(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)
	_, err := f.svc.Reschedule(ctx, f.teacher, f.class.ID, a.ID, service.RescheduleInput{StartsAt: at(22, 9, 0), EndsAt: at(22, 11, 0)})
	require.NoError(t, err)
	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, a.ID, "Falta de energia")
	require.NoError(t, err)
	wantKinds := []domain.EventKind{domain.EventCreated, domain.EventRescheduled, domain.EventCanceled}

	f.users.names[f.teacher.UserID] = "profa@utfpr.edu.br"
	d, err := f.svc.Detail(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, "profa@utfpr.edu.br", d.CreatedByName)
	assert.Equal(t, "profa@utfpr.edu.br", d.UpdatedByName)
	assert.Equal(t, wantKinds, eventKinds(d.Events))
	for _, e := range d.Events {
		assert.Equal(t, "profa@utfpr.edu.br", e.ActorName)
	}

	delete(f.users.names, f.teacher.UserID)
	d, err = f.svc.Detail(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Empty(t, d.CreatedByName, "a removed user has no name, and the screen fills the gap")
	assert.Equal(t, wantKinds, eventKinds(d.Events), "no event is left out because its author is gone")
	for _, e := range d.Events {
		assert.Empty(t, e.ActorName)
	}
}

func eventKinds(events []service.EventView) []domain.EventKind {
	kinds := make([]domain.EventKind, len(events))
	for i, e := range events {
		kinds[i] = e.Kind
	}
	return kinds
}

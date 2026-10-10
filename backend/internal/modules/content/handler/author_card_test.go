package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

func (f *fakeAuthoring) SaveCard(_ context.Context, who service.Actor, _ uuid.UUID, in service.SaveCardInput) ([]domain.ContentBlock, error) {
	f.who, f.card = who, in
	return []domain.ContentBlock{f.block(), f.block()}, f.err
}

func (f *fakeAuthoring) SetActiveMany(_ context.Context, who service.Actor, _ uuid.UUID, ids []uuid.UUID, active bool) ([]domain.ContentBlock, error) {
	f.who, f.order = who, ids
	b := f.block()
	if !active {
		b.InactiveAt = b.EditedByTeacherAt
	}
	return []domain.ContentBlock{b}, f.err
}

// Covers SPEC-019 5.7.
func TestAuthorHandler_SaveCard(t *testing.T) {
	f := &fakeAuthoring{}
	head, after := uuid.New(), uuid.New()
	body := `{"replaceIds":["` + head.String() + `"],"afterBlockId":"` + after.String() + `","force":true,"blocks":[
		{"id":"` + head.String() + `","updatedAt":"2026-10-09T12:00:00Z","type":"TEXT","payload":{"title":"Card","html":""}},
		{"type":"COMMAND","payload":{"steps":[{"command":"ls"}]}}]}`

	code, resp := authorCall(t, f, teacher, 100, http.MethodPut, "/teacher/modules/"+uuid.NewString()+"/cards", body)
	assert.Equal(t, http.StatusOK, code)
	assert.Len(t, resp["blocks"], 2)

	assert.Equal(t, []uuid.UUID{head}, f.card.ReplaceIDs)
	assert.Equal(t, after, *f.card.AfterID)
	assert.True(t, f.card.Force)
	require.Len(t, f.card.Blocks, 2)
	assert.Equal(t, head, *f.card.Blocks[0].ID)
	assert.NotNil(t, f.card.Blocks[0].UpdatedAt)
	assert.Nil(t, f.card.Blocks[1].ID, "a block without id is created")
	assert.Equal(t, domain.BlockCommand, f.card.Blocks[1].Type)
}

func TestAuthorHandler_SaveCardErrors(t *testing.T) {
	path := "/teacher/modules/" + uuid.NewString() + "/cards"
	cases := map[string]struct {
		err    error
		status int
	}{
		"invalid payload": {&domain.PayloadError{Fields: []domain.FieldError{{Field: "blocks[0].html", Reason: "required"}}}, 400},
		"invalid card":    {service.ErrInvalidCard, 400},
		"conflict":        {service.ErrBlockConflict, 409},
		"forbidden":       {service.ErrForbidden, 403},
		"not found":       {service.ErrBlockNotFound, 404},
	}
	for name, tc := range cases {
		code, _ := authorCall(t, &fakeAuthoring{err: tc.err}, teacher, 100, http.MethodPut, path, `{"blocks":[]}`)
		assert.Equal(t, tc.status, code, name)
	}
	code, _ := authorCall(t, &fakeAuthoring{}, teacher, 100, http.MethodPut, path, `nope`)
	assert.Equal(t, http.StatusBadRequest, code)
}

// Covers SPEC-019 5.8.
func TestAuthorHandler_SetCardActive(t *testing.T) {
	f := &fakeAuthoring{}
	a, b := uuid.New(), uuid.New()
	path := "/teacher/modules/" + uuid.NewString() + "/cards/active"

	code, resp := authorCall(t, f, teacher, 100, http.MethodPut, path, `{"blockIds":["`+a.String()+`","`+b.String()+`"],"active":false}`)
	assert.Equal(t, http.StatusOK, code)
	assert.Len(t, resp["blocks"], 1)
	assert.Equal(t, []uuid.UUID{a, b}, f.order)

	code, _ = authorCall(t, f, teacher, 100, http.MethodPut, path, `{"blockIds":[],"active":false}`)
	assert.Equal(t, http.StatusBadRequest, code)
	code, _ = authorCall(t, f, teacher, 100, http.MethodPut, path, `{"blockIds":["`+a.String()+`"]}`)
	assert.Equal(t, http.StatusBadRequest, code)
	code, _ = authorCall(t, &fakeAuthoring{err: service.ErrInvalidCard}, teacher, 100, http.MethodPut, path, `{"blockIds":["`+a.String()+`"],"active":true}`)
	assert.Equal(t, http.StatusBadRequest, code)
}

package repository_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Covers SPEC-096 section 4: migration 00051 creates the admissions and the finish of the exam, and going down takes them away.
func TestMigration00051_UpAndDown(t *testing.T) {
	e := newEnv(t)
	up, down := migrationParts(t, "00051_")
	count := func() int64 {
		var n int64
		require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT
			(SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'assessment_admissions') +
			(SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'assessments'
				AND column_name IN ('finished_at', 'finished_by'))`).Scan(&n).Error)
		return n
	}
	assert.Equal(t, int64(3), count())
	runMigration(t, e, down)
	assert.Zero(t, count())
	runMigration(t, e, up)
	assert.Equal(t, int64(3), count())
}

// Covers SPEC-096 RN-01: an admission is stored once; admitting again gives back only who was not admitted yet, and the list of the admitted reads
// them all.
func TestAdmissions_InsertIgnoresTheAdmitted(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	got, err := e.repo.Admit(e.ctx, a.ID, []uuid.UUID{e.student.ID}, e.now, e.teacher.ID)
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{e.student.ID}, got)
	got, err = e.repo.Admit(e.ctx, a.ID, []uuid.UUID{e.student.ID}, e.now.Add(time.Minute), e.teacher.ID)
	require.NoError(t, err)
	assert.Empty(t, got, "already admitted")

	admitted, err := e.repo.Admitted(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID]bool{e.student.ID: true}, admitted)
	other, err := e.repo.Admitted(e.ctx, uuid.New())
	require.NoError(t, err)
	assert.Empty(t, other)
}

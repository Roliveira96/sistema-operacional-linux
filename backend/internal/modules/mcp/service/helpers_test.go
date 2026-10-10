package service_test

import (
	"encoding/json"

	"github.com/google/uuid"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

func exerciseRecord(title, difficulty, conditions string, dependsOn *uuid.UUID) contentservice.ExerciseRecord {
	q := contentdomain.Question{ID: uuid.New(), Title: title, Difficulty: difficulty, Status: contentdomain.StatusDraft, DependsOn: dependsOn}
	if conditions != "" {
		q.EndConditions = json.RawMessage(conditions)
	}
	return contentservice.ExerciseRecord{Question: q}
}

func blockOf(typ, payload string) contentdomain.ContentBlock {
	return contentdomain.ContentBlock{ID: uuid.New(), BlockType: contentdomain.BlockType(typ), Payload: json.RawMessage(payload)}
}

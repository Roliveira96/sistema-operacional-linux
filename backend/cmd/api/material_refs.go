package main

import (
	"errors"

	classroomdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	scheduledomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	scheduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
)

// scheduleFiles lets the schedule check the files of the materials of a lesson by the rule of the presentations of the live classroom: PDF, PNG,
// JPEG or WebP by their first bytes, with the limit of each format (SPEC-074 RN-02, SPEC-068). The schedule does not import the classroom.
type scheduleFiles struct{}

func (scheduleFiles) Classify(pageCount int, size int64, header []byte) (scheduleservice.ClassifiedFile, error) {
	// the title is the one of the material, which the schedule checks: any valid one does here
	upload, err := classroomdomain.ClassifyUpload("file", pageCount, size, header)
	switch {
	case err == nil:
		return scheduleservice.ClassifiedFile{ContentType: upload.ContentType, Extension: upload.Extension, PageCount: upload.PageCount}, nil
	case errors.Is(err, classroomdomain.ErrFileTooLarge):
		return scheduleservice.ClassifiedFile{}, scheduledomain.ErrMaterialFileTooLarge
	case errors.Is(err, classroomdomain.ErrInvalidFile), errors.Is(err, classroomdomain.ErrInvalidPDF):
		field := "file"
		var fe *classroomdomain.FieldError
		if errors.As(err, &fe) {
			field = fe.Field
		}
		return scheduleservice.ClassifiedFile{}, &scheduledomain.FieldError{Field: field, Err: scheduledomain.ErrInvalidMaterialFile}
	}
	return scheduleservice.ClassifiedFile{}, err
}

package domain

import "errors"

// Errors of the domain. The handler turns each one into its problem type (SPEC-075 section 5).
var (
	ErrInvalidAssessment     = errors.New("the assessment is not valid")
	ErrInvalidPeriod         = errors.New("the period is not valid")
	ErrWeightsMismatch       = errors.New("the weights do not add up to the maximum score")
	ErrDrawMismatch          = errors.New("the quantities by level do not add up to the total")
	ErrQuestionNotEligible   = errors.New("the question cannot be used in this assessment")
	ErrStudentNotInClass     = errors.New("the student has no active enrollment in the class")
	ErrSessionNotFound       = errors.New("the lesson of the schedule was not found")
	ErrSessionNotConvertible = errors.New("the lesson cannot become an assessment")
	ErrModuleNotAssigned     = errors.New("the module is not assigned to the class")
	ErrAssessmentFrozen      = errors.New("the assessment already started and its composition is frozen")
	ErrAssessmentEnded       = errors.New("the assessment already ended")
	ErrAssessmentCanceled    = errors.New("the assessment was canceled")
	ErrReasonRequired        = errors.New("a reason is required")
	ErrGradesHomologated     = errors.New("the assessment has homologated grades")
	ErrForbidden             = errors.New("you are not allowed to do this")
	ErrClassNotFound         = errors.New("class not found")
	ErrAssessmentNotFound    = errors.New("assessment not found")
	ErrInsufficientStock     = errors.New("the module has too few questions in some level")
)

// Shortage is a level of difficulty that the bank cannot supply: what the draw asks for and what there is.
type Shortage struct {
	Difficulty Difficulty
	Asked      int
	Available  int
}

// StockError is ErrInsufficientStock with the levels that fall short (SPEC-075 RN-07).
type StockError struct{ Short []Shortage }

func (e *StockError) Error() string { return ErrInsufficientStock.Error() }

// Is makes errors.Is(err, ErrInsufficientStock) hold.
func (e *StockError) Is(target error) bool { return target == ErrInsufficientStock }

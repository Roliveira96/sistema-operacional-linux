package domain

import (
	"database/sql/driver"
	"fmt"
	"math"
	"strconv"
)

// Score is an amount of points in whole hundredths: 10 points is Score(1000). It keeps the sums of weights exact, where a float would give
// 0.1 + 0.2 != 0.3 (SPEC-075 RN-06, RN-07), and is the numeric(5,2) of the database.
type Score int64

// Points turns points into a Score, rounding to the hundredth.
func Points(v float64) Score { return Score(math.Round(v * 100)) }

// Float gives the points, for the JSON of the API.
func (s Score) Float() float64 { return float64(s) / 100 }

// Value writes the score as the decimal text numeric(5,2) reads, with no float in the way.
func (s Score) Value() (driver.Value, error) {
	n := int64(s)
	sign := ""
	if n < 0 {
		sign, n = "-", -n
	}
	return fmt.Sprintf("%s%d.%02d", sign, n/100, n%100), nil
}

// Scan reads a numeric(5,2), which the driver gives as text or as a number.
func (s *Score) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*s = 0
	case int64:
		*s = Score(v * 100)
	case float64:
		*s = Points(v)
	case []byte:
		return s.scanText(string(v))
	case string:
		return s.scanText(v)
	default:
		return fmt.Errorf("cannot read a score from %T", src)
	}
	return nil
}

func (s *Score) scanText(text string) error {
	f, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return fmt.Errorf("read the score %q: %w", text, err)
	}
	*s = Points(f)
	return nil
}

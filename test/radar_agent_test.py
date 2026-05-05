import unittest

import radar


MESSY_ROWS = [
    {" Customer ID ": " C001 ", " Segment ": " enterprise ", " Revenue ": "1200.00", " Churn Flag ": "No", " Empty ": ""},
    {" Customer ID ": " C002 ", " Segment ": "Enterprise", " Revenue ": "", " Churn Flag ": "no", " Empty ": ""},
    {" Customer ID ": " C003 ", " Segment ": "SMB ", " Revenue ": "0.00", " Churn Flag ": "YES", " Empty ": ""},
    {" Customer ID ": " C003 ", " Segment ": "SMB ", " Revenue ": "0.00", " Churn Flag ": "YES", " Empty ": ""},
    {" Customer ID ": " C004 ", " Segment ": "mid market", " Revenue ": "150000.00", " Churn Flag ": "N", " Empty ": ""},
]


class RadarAgentTest(unittest.TestCase):
    def test_profile_detects_quality_issues(self):
        result = radar.profile(MESSY_ROWS, use_case="predict churn")
        issue_types = {issue["type"] for issue in result["qualityIssues"]}
        self.assertIn("messy_header", issue_types)
        self.assertIn("missing_values", issue_types)
        self.assertIn("duplicates", issue_types)

    def test_plan_generates_actions_and_cells(self):
        cleaning_plan = radar.plan(MESSY_ROWS, use_case="predict churn")
        action_types = {action["type"] for action in cleaning_plan["safeAutoFixes"] + cleaning_plan["recommendedActions"]}
        self.assertIn("rename_header", action_types)
        self.assertIn("impute_null", action_types)
        self.assertTrue(cleaning_plan["generatedCode"])

    def test_clean_does_not_mutate_original_records(self):
        cleaning_plan = radar.plan(MESSY_ROWS, use_case="predict churn")
        for action in cleaning_plan["recommendedActions"]:
            if action["type"] in {"standardize_case", "impute_null", "remove_duplicates", "flag_outliers"}:
                action["approved"] = True

        cleaned = radar.clean(MESSY_ROWS, cleaning_plan)
        self.assertIn("customer_id", cleaned["headers"])
        self.assertIn(" Customer ID ", MESSY_ROWS[0])

    def test_run_returns_notebook_artifacts(self):
        result = radar.run(MESSY_ROWS, use_case="predict churn", apply=False)
        self.assertTrue(result.notebook_cells)
        self.assertIn("analysisSuggestions", result.report)


if __name__ == "__main__":
    unittest.main()

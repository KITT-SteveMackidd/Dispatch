export type JobPosting = {
  id: string;
  title: string;
  company: string;
  location: string;
  mode: "Remote" | "Hybrid" | "On-site" | "Unspecified";
  posted: string;
  salary?: string;
  fit: number;
  summary: string;
  url: string;
};

// Snapshot refreshed from latest Jody run (2026-02-27T00:03Z)
// Search is now paused by user request until explicit go-ahead.
export const jobPostings: JobPosting[] = [
  { id: "JP-001", title: "Mobile Software Developer (React Native)", company: "TouchBistro", location: "Canada", mode: "Remote", posted: "Not listed", fit: 97, summary: "Canada-remote React Native product role.", url: "https://boards.greenhouse.io/touchbistro/jobs/5932485003" },
  { id: "JP-002", title: "Senior React Native Engineer, Mobile", company: "Fullscript", location: "Canada", mode: "Unspecified", posted: "Not listed", fit: 96, summary: "Senior RN mobile role in Canadian market.", url: "https://jobs.lever.co/fullscript/fc05cf1a-5b10-4731-9543-a3e0a070e691" },
  { id: "JP-003", title: "Senior Software Engineer - React Native", company: "Samsara", location: "Canada", mode: "Remote", posted: "Not listed", fit: 95, summary: "Remote Canada RN senior engineering role.", url: "https://boards.greenhouse.io/samsara/jobs/6827906" },
  { id: "JP-004", title: "Senior React Native Engineer (Mobile)", company: "Clariti Cloud", location: "Canada", mode: "Unspecified", posted: "Not listed", fit: 95, summary: "Canada-focused RN engineering role.", url: "https://boards.greenhouse.io/clariticloudinc/jobs/6338188003" },
  { id: "JP-005", title: "Staff Mobile Developer", company: "Nearform", location: "Canada", mode: "Remote", posted: "Not listed", fit: 94, summary: "Staff-level mobile role with Canada remote alignment.", url: "https://boards.greenhouse.io/nearform/jobs/6508578003" },
  { id: "JP-006", title: "Intermediate React Native Developer", company: "Brilliant Harvest", location: "Remote (Canada)", mode: "Remote", posted: "Not listed", fit: 94, summary: "Canada remote intermediate RN role.", url: "https://ca.indeed.com/viewjob?jk=df057e66790e20ec" },
  { id: "JP-007", title: "Senior Full-Stack Developer (React Native)", company: "Eli Health", location: "Canada", mode: "Unspecified", posted: "Not listed", fit: 93, summary: "RN + full-stack role with Canada eligibility.", url: "https://jobs.ashbyhq.com/eli/3e7ea8e6-b77c-481b-9ab0-1b415ee5d37b" },
  { id: "JP-008", title: "React Native Developer", company: "Barber-OS Technologies Inc", location: "Canada", mode: "Unspecified", posted: "Not listed", fit: 92, summary: "Direct RN role from LinkedIn source.", url: "https://ca.linkedin.com/jobs/view/react-native-developer-at-barber-os-technologies-inc-4089823059" },
  { id: "JP-009", title: "React Native Developer", company: "VO2 Group", location: "Montreal, QC", mode: "Unspecified", posted: "Not listed", fit: 89, summary: "Canadian RN opportunity.", url: "https://ca.linkedin.com/jobs/view/vo2-canada-d%C3%A9veloppeuse-eur-react-native-developer-at-vo2-group-4295406929" },
  { id: "JP-010", title: "React Native Full Stack Software Developer", company: "Indeed Listing", location: "Toronto, ON", mode: "Unspecified", posted: "Not listed", fit: 88, summary: "RN + full-stack listing in Canada.", url: "https://ca.indeed.com/viewjob?jk=92d1ae2337c6d849" },
  { id: "JP-011", title: "Full Stack Web Developer", company: "Arcurve Inc.", location: "Calgary, AB / Canada", mode: "Unspecified", posted: "Not listed", fit: 88, summary: "Strong Calgary fallback with JS + backend relevance.", url: "https://www.eluta.ca/spl/full-stack-web-developer-b8447bbfa48cc1a09dc2b3ace7f44295" },
  { id: "JP-012", title: "Senior Software Engineer (React/React Native)", company: "CompanyCam", location: "Remote", mode: "Remote", posted: "Not listed", fit: 87, summary: "React + React Native remote role (Canada needs confirmation).", url: "https://weworkremotely.com/remote-jobs/companycam-senior-software-engineer-react-react-native" },
  { id: "JP-013", title: "Sr Full Stack Software Engineer (React Native)", company: "Meo Health", location: "Remote (Canada)", mode: "Remote", posted: "Not listed", fit: 87, summary: "Full-stack RN role with Canada remote mention.", url: "https://weworkremotely.com/remote-jobs/meo-health-sr-full-stack-software-engineer-react-native" },
  { id: "JP-014", title: "React Native Developer", company: "Quizgecko", location: "Toronto, Canada", mode: "Remote", posted: "Not listed", fit: 86, summary: "RN remote listing with Canada orientation.", url: "https://weworkremotely.com/remote-jobs/quizgecko-com-react-native-developer" },
  { id: "JP-015", title: "Senior React Native Engineer", company: "MoonPay", location: "Remote", mode: "Remote", posted: "Not listed", fit: 84, summary: "Senior RN remote role (Canada eligibility to confirm).", url: "https://jobs.lever.co/moonpay/dbf2422f-0e8e-4459-99df-153fb7b65221" },
  { id: "JP-016", title: "Senior React Native Developer", company: "Proxify AB", location: "Remote", mode: "Remote", posted: "Not listed", fit: 84, summary: "Senior RN remote contractor role.", url: "https://weworkremotely.com/remote-jobs/proxify-ab-senior-react-native-developer-7" },
  { id: "JP-017", title: "Software Developer (C# .NET / SQL)", company: "Indeed Listing", location: "Calgary, AB", mode: "Unspecified", posted: "Not listed", fit: 83, summary: "Local Calgary C#/.NET fallback.", url: "https://ca.indeed.com/viewjob?jk=7f0a05571ae1b5f1" },
  { id: "JP-018", title: "Full Stack Software Developer", company: "Indeed Listing", location: "Calgary, AB", mode: "Hybrid", posted: "Not listed", fit: 83, summary: "Hybrid Calgary full-stack role.", url: "https://emplois.ca.indeed.com/viewjob?jk=efd2af9f7e12c9bf" },
  { id: "JP-019", title: ".NET Developer / Application Developer", company: "Indeed Listing", location: "Calgary, AB", mode: "Unspecified", posted: "Not listed", fit: 82, summary: "Calgary .NET role.", url: "https://ca.indeed.com/viewjob?jk=5861263f15a8be8b" },
  { id: "JP-020", title: "Full stack developer", company: "Comtech", location: "Calgary, AB", mode: "Unspecified", posted: "Not listed", fit: 81, summary: "Job Bank Calgary full-stack posting.", url: "https://www.jobbank.gc.ca/jobsearch/jobposting/45434718" },
  { id: "JP-021", title: "Senior software developer", company: "Job Bank Listing", location: "Calgary Region, AB", mode: "Unspecified", posted: "Not listed", fit: 80, summary: "Senior software role in Calgary region.", url: "https://www.jobbank.gc.ca/jobsearch/jobposting/49010428" },
  { id: "JP-022", title: "Software developer", company: "BioAro Inc.", location: "Calgary, AB", mode: "Unspecified", posted: "Not listed", fit: 79, summary: "Calgary local software developer role.", url: "https://ab.jobbank.gc.ca/jobsearch/jobposting/42265198" },
  { id: "JP-023", title: "Web developer", company: "Geronimo With Compassion Inc.", location: "Calgary, AB", mode: "Unspecified", posted: "Not listed", fit: 76, summary: "Calgary web dev role (adjacent fit).", url: "https://www.jobbank.gc.ca/jobsearch/jobposting/41112186" },
  { id: "JP-024", title: "Software developer", company: "STAR SAP CONSULTING", location: "Calgary, AB", mode: "Unspecified", posted: "Not listed", fit: 76, summary: "Calgary software role (generalist).", url: "https://www.jobbank.gc.ca/jobsearch/jobposting/39142913" },
  { id: "JP-025", title: "Software developer", company: "SkipTheDishes", location: "Calgary, AB", mode: "Unspecified", posted: "Not listed", fit: 78, summary: "Calgary software role.", url: "https://nb.jobbank.gc.ca/jobsearch/jobposting/35520643" },
  { id: "JP-026", title: "Full-Stack Software Developer", company: "Vivid Theory Inc.", location: "Calgary, AB", mode: "Unspecified", posted: "Not listed", fit: 79, summary: "Calgary full-stack role.", url: "https://www.eluta.ca/spl/full-stack-software-developer-c59f869b015c87df6f572ad18a23d41d" },
  { id: "JP-027", title: "Full Stack Developer - Intermediate", company: "LaPrairie Group", location: "Calgary, AB", mode: "On-site", posted: "Not listed", fit: 78, summary: "Calgary in-office full-stack role.", url: "https://www.eluta.ca/spl/full-stack-developer-intermediate-46c967ce019503ff2466202dbaf6570e" },
  { id: "JP-028", title: "Full Stack Software Engineer", company: "RS Energy Group Canada Inc.", location: "Calgary, AB", mode: "Unspecified", posted: "Not listed", fit: 78, summary: "Calgary full-stack engineering role.", url: "https://www.eluta.ca/spl/full-stack-software-engineer-c57d25b653513e14cfcadfe0f2566898" },
  { id: "JP-029", title: "Software Developer / Programmer", company: "Pleasant Solutions", location: "Calgary, AB", mode: "Unspecified", posted: "Not listed", fit: 74, summary: "Local Calgary software role.", url: "https://www.workopolis.com/jobsearch/viewjob/TH4_iDjQinC70mXcnhfSvU6J9yxQMiKzfrFjI8SOjxBdxLLLtJ22Fpdt5fUs4s95" },
  { id: "JP-030", title: "Remote React Native Developer", company: "Toptal", location: "Canada/US", mode: "Remote", posted: "Not listed", fit: 73, summary: "Remote RN contractor role.", url: "https://weworkremotely.com/remote-jobs/toptal-react-native-developer" }
];

export const top3JobPostings = jobPostings.slice(0, 3);

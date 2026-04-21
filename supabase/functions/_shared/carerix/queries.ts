// Carerix GraphQL v1 queries. Confirmed query names + Pageable input via
// docs.carerix.io. Field lists are intentionally minimal — only what the public
// v1 schema exposes.

export function companiesQuery(page: number, size: number): string {
  return `query {
    companyPage(pageable: { page: ${page}, size: ${size} }) {
      totalElements
      items {
        _id
        name
        displayName
      }
    }
  }`;
}

export function contactsQuery(page: number, size: number): string {
  return `query {
    contactPage(pageable: { page: ${page}, size: ${size} }) {
      totalElements
      items {
        _id
        firstName
        lastName
        displayName
        company { _id name }
        emailAddresses(pageable: { page: 0, size: 1 }) {
          items { value primary }
        }
      }
    }
  }`;
}

export function candidatesQuery(page: number, size: number): string {
  return `query {
    candidatePage(pageable: { page: ${page}, size: ${size} }) {
      totalElements
      items {
        _id
        firstName
        lastName
        displayName
        emailAddresses(pageable: { page: 0, size: 1 }) {
          items { value primary }
        }
      }
    }
  }`;
}

export function vacanciesQuery(page: number, size: number): string {
  return `query {
    vacancyPage(pageable: { page: ${page}, size: ${size} }) {
      totalElements
      items {
        _id
        jobTitle
        displayName
      }
    }
  }`;
}

export function connectionTestQuery(): string {
  return `query {
    companyPage(pageable: { page: 0, size: 1 }) {
      totalElements
    }
  }`;
}

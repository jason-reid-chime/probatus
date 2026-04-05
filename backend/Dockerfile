FROM golang:1.24-alpine AS builder
WORKDIR /app
# go 1.24.0
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o /probatus ./cmd/api

FROM alpine:3.21
RUN apk --no-cache add ca-certificates
COPY --from=builder /probatus /probatus
EXPOSE 8080
ENTRYPOINT ["/probatus"]

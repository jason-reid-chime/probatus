FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /probatus ./cmd/api

FROM alpine:3.21
RUN apk --no-cache add ca-certificates
COPY --from=builder /probatus /probatus
EXPOSE 8080
ENTRYPOINT ["/probatus"]
